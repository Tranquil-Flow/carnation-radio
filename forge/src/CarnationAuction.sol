// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CarnationAudioNFT.sol";

/// @title CarnationAuction
/// @author Tranquil-Flow
/// @notice A contract for running auctions on audio sets, hosting the audio on Swarm and minting an NFT to auction winner 
contract CarnationAuction is ReentrancyGuard {

    uint public auctionLength;
    uint public auctionID;

    CarnationAudioNFT public audioNFT;

    struct Auction {
        uint auctionStartTime;
        uint auctionFinishTime;
        bool auctionFinished;
        string audioName;
        address[] bidders;
        uint highestBid;
        address highestBidder;
    }

    struct Bid {
        address bidder;
        uint bidAmount;
        bool bidWithdrawn;
        bool winningBid;
    }

    mapping(uint => Auction) public auctions;
    mapping(uint => mapping(address => Bid)) public bids;

    error AuctionNotStarted();
    error AuctionNotEnded();
    error AuctionAlreadyEnded();
    error BidAmountZero();
    error BidAlreadyWithdrawn();
    error CannotWithdrawWinningBid();
    error AuctionNonExistent();
    error BidTooLow();
    error ETHTransferOutFailed();

    event BidPlaced(uint indexed audioSlotID, address indexed bidder, uint bidAmount);
    event BidEdited(uint indexed audioSlotID, address indexed bidder, uint newBidAmount);
    event AuctionStarted(uint indexed audioSlotID, uint auctionStartTime);
    event AuctionEnded(uint indexed audioSlotID, address indexed winner, uint winningBid, string swarmLink);

    /// @notice Initializes key state variables and starts the first auction
    /// @param _nftAddress The address of the AudioNFT that will be bid upon and minted after each auction 
    constructor(address _nftAddress) {
        auctionLength = 3600; // 1 day per auction
        audioNFT = CarnationAudioNFT(_nftAddress);
        startAuction();
    }

    /// @notice Places a bid on an auction
    /// @dev The msg.value is the amount to be bid
    /// @param _audioSlotID The ID of the auction being bid upon
    function placeBid(uint _audioSlotID) external payable nonReentrant {
        Auction storage currentAuction = auctions[_audioSlotID];

        // Check if the auction exists
        require(currentAuction.auctionStartTime != 0, "Auction does not exist");

        // Check if the auction is ongoing
        if (block.timestamp < currentAuction.auctionStartTime) revert AuctionNotStarted();
        if (block.timestamp > currentAuction.auctionFinishTime) revert AuctionAlreadyEnded();

        // Check bid amount is greater than zero and higher than current highest bid
        if (msg.value == 0) revert BidAmountZero();
        if (msg.value <= currentAuction.highestBid) revert BidTooLow();

        // Update auction information
        currentAuction.highestBid = msg.value;
        currentAuction.highestBidder = msg.sender;
        currentAuction.bidders.push(msg.sender);

        emit BidPlaced(_audioSlotID, msg.sender, msg.value);
    }

    /// @notice Increases the bid amount of a user's bid on an auction
    /// @dev Makes an ETH transfer of the msg.value - previous bidAmount
    /// @param _audioSlotID  The ID of the auction being bid upon
    function editBid(uint _audioSlotID) external payable nonReentrant {
        Auction storage currentAuction = auctions[_audioSlotID];
        Bid storage existingBid = bids[_audioSlotID][msg.sender];
        
        // Check the auction is ongoing
        if (block.timestamp < currentAuction.auctionStartTime) revert AuctionNotStarted();
        if (block.timestamp > currentAuction.auctionStartTime + auctionLength) revert AuctionAlreadyEnded();

        // Calculate the new total bid amount
        uint newBidAmount = existingBid.bidAmount + msg.value;

        // Check bid amount is greater than zero and higher than the current highest bid
        if (msg.value == 0) revert BidAmountZero();
        if (newBidAmount <= currentAuction.highestBid) revert BidTooLow();

        // Check if the new bid amount is higher than the current highest bid 
        if (newBidAmount <= currentAuction.highestBid) revert BidTooLow();

        // Update the bid amount
        existingBid.bidAmount = newBidAmount;

        // Update the auction information
        currentAuction.highestBid = newBidAmount;
        currentAuction.highestBidder = msg.sender;

        emit BidEdited(_audioSlotID, msg.sender, newBidAmount);
    }

    /// @notice Withdraws a bid placed on an auction
    /// @dev Only callable after the auction has finished
    /// @param _audioSlotID The ID of the auction that was bid upon
    function withdrawBid(uint _audioSlotID) external nonReentrant {
        Auction storage currentAuction = auctions[_audioSlotID];
        Bid storage existingBid = bids[_audioSlotID][msg.sender];

        // Check that the auction has finished
        if (block.timestamp < currentAuction.auctionFinishTime) {revert AuctionNotEnded();}

        // Check if the bid has been withdrawn already
        if (existingBid.bidWithdrawn == true) {revert BidAlreadyWithdrawn();}

        // Check if the bid is the winning bid
        if (existingBid.winningBid == true) {revert CannotWithdrawWinningBid();}

        // Set the bid to withdrawn
        existingBid.bidWithdrawn = true;

        // Withdraw the bid
        (bool success, ) = msg.sender.call{value: existingBid.bidAmount}("");
        if (!success) {revert ETHTransferOutFailed();}
    }

    /// @dev Creates a new auction
    function startAuction() internal {
        // Create auction with new ID
        auctionID++;
        Auction storage currentAuction = auctions[auctionID];

        // Set the auction start and finish time
        uint currentTime = block.timestamp;
        currentAuction.auctionStartTime = currentTime;
        currentAuction.auctionFinishTime = currentTime + auctionLength;

        emit AuctionStarted(auctionID, currentTime);
    }

    /// @notice Ends the last auction and begins the next auction
    /// @param _audioSlotID The ID of the last auction
    function endAuction(uint _audioSlotID) external {
        Auction storage currentAuction = auctions[_audioSlotID];

        // Check  if the auction has ended
        if (block.timestamp < currentAuction.auctionStartTime + auctionLength) {revert AuctionNotEnded();}

        // Check if endAuction has already been called
        if (auctions[_audioSlotID].auctionFinished) {revert AuctionAlreadyEnded();}

        // Get highest bidder
        address _highestBidder;
        uint _highestBid;

        for (uint i = 0; i < currentAuction.bidders.length; i++) {
            address bidder = currentAuction.bidders[i];
            uint _bidAmount = bids[_audioSlotID][bidder].bidAmount;
            if (_bidAmount > _highestBid) {
                _highestBid = _bidAmount;
                _highestBidder = bidder;
           }
        }

        // uint swarmHostingCost;
        string memory swarmLink;        
        // Implement Swarm hosting logic here 

        // Check a bid occured
        if (_highestBidder != address(0)) {
            // If so, mint NFT to the highest bidder
            audioNFT.mint(_highestBidder, swarmLink);
        }

        // End the auction
        currentAuction.auctionFinished = true;
        
        // Set the bid as the winning bid and define highest bid info
        Bid storage winningBid = bids[_audioSlotID][_highestBidder];
        winningBid.winningBid = true;
        currentAuction.highestBidder = _highestBidder;
        currentAuction.highestBid = _highestBid;


        // Start a new auction
        startAuction();

        emit AuctionEnded(_audioSlotID, _highestBidder, _highestBid, swarmLink);
    }

}