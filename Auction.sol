// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AudioSetNFT.sol";

// TODO: Add events
// TODO: Voting system verified by zupass

contract Auction is ReentrancyGuard {

    uint public auctionLength;

    AudioSetNFT public audioSetNFT;

    struct AudioSlot {
        uint auctionStartTime;
        bool auctionFinished;
        string audioName;
    }

    struct Bid {
        address bidder;
        uint bidAmount;
    }

    mapping(uint => AudioSlot) public audioSlots;
    mapping(uint => mapping(address => Bid)) public bids;

    error ETHTransferInFailed();
    error ETHTransferOutFailed();
    error AuctionAlreadyStarted();
    error AuctionNotStarted();
    error AuctionNotEnded();
    error AuctionAlreadyEnded();
    error BidAmountZero();

    event AuctionStarted(uint indexed audioSlotID, string audioName, uint auctionStartTime);
    event BidPlaced(uint indexed audioSlotID, address indexed bidder, uint bidAmount);
    event BidRemoved(uint indexed audioSlotID, address indexed bidder);
    event AuctionEnded(uint indexed audioSlotID, address indexed winner, uint winningBid, string swarmLink);

    constructor(
        uint _auctionLength,
        address _nftAddress
    ) public {
        // Define state variables
        auctionLength = _auctionLength;
        audioSetNFT = AudioSetNFT(_nftAddress);
    }

    function placeBid(uint _audioSlotID) external payable nonReentrant {
        AudioSlot storage slot = audioSlots[_audioSlotID];

        // Check if the auction is ongoing
        if (block.timestamp < slot.auctionStartTime) {revert AuctionNotStarted();}
        if (block.timestamp > slot.auctionStartTime + auctionLength) {revert AuctionAlreadyEnded();}

        // Check bid amount is greater than zero
        if (msg.value == 0) {revert BidAmountZero();}

        // Transfer the bid amount to the contract
        (bool success, ) = recipient.call{value: msg.value}("");
        if (!success) {revert(ETHTransferInFailed());}

        // Add bid to bid list for the audio slot
        bids[_audioSlotID][msg.sender] = Bid(msg.sender, msg.value);

        emit BidPlaced(_audioSlotID, msg.sender, msg.value);
    }

    function removeBid(uint _audioSlotID) external nonReentrant {
        AudioSlot storage slot = audioSlots[_audioSlotID];
        Bid storage existingBid = bids[_audioSlotID][msg.sender];

        // Check the auction has ended
        if (block.timestamp < slot.auctionStartTime + auctionLength) {revert AuctionNotEnded();}
        
        // Transfer the bid amount back to the bidder
        (bool success, ) = msg.sender.call{value: musicSlots[highestBidder].highestBidAmount}("");
        if (!success) {revert ETHTransferOutFailed();}

        emit BidRemoved(_audioSlotID, msg.sender);
    }

    function editBid(uint _audioSlotID) external payable nonReentrant {
        AudioSlot storage slot = audioSlots[_audioSlotID];
        Bid storage existingBid = bids[_audioSlotID][msg.sender];

        // Check the auction is ongoing
        if (block.timestamp < slot.auctionStartTime) {revert AuctionNotStarted();}
        if (block.timestamp > slot.auctionStartTime + auctionLength) {revert AuctionAlreadyEnded();}

        // Check bid amount is greater than zero
        if (msg.value == 0) {revert BidAmountZero();}

        // Transfer the bid amount to the contract
        (bool success, ) = recipient.call{value: msg.value}("");
        if (!success) {revert ETHTransferInFailed();}

        // Update the bid amount
        uint newBidAmount = existingBid.bidAmount + msg.value;
        existingBid.bidAmount = newBidAmount;

        emit BidRemoved(audioSlotID, bidder);
        emit BidPlaced(_audioSlotID, msg.sender, newBidAmount);
    }

    function startAuction(uint _audioSlotID, string calldata _audioName) external {
        AudioSlot storage slot = audioSlots[_audioSlotID];
        
        // Check if the auction has already started
        if (slot.auctionStartTime != 0) {revert AuctionAlreadyStarted();}

        // Set the auction start time
        uint currentTime = block.timestamp;
        slot.auctionStartTime = currentTime;

        // Set the audio name
        slot.audioName = _audioName;

        emit AuctionStarted(_audioSlotID, _audioName, currentTime);
    }

    function endAuction(uint _audioSlotID) external {
        AudioSlot storage slot = audioSlots[_audioSlotID];

        // Check if the auction has ended
        if (block.timestamp < slot.auctionStartTime + auctionLength) {revert AuctionNotEnded();}

        // Check if endAuction has already been called
        if (audioSlots[_audioSlotID].auctionFinished) {revert AuctionAlreadyEnded();}

        // Get highest bidder
        address highestBidder;
        uint highestBid;

        for (uint i = 0; i < slot.bidders.length; i++) {
            address bidder = slot.bidders[i];
            uint bidAmount = bids[_audioSlotID][bidder].amount;
            if (bidAmount > highestBid) {
                highestBid = bidAmount;
                highestBidder = bidder;
            }
        }

        uint swarmHostingCost;
        string memory swarmLink;        
        // Implement Swarm hosting logic here 

        // Check a bid occured
        if (highestBidder != address(0)) {
            // If so, mint NFT to the highest bidder
            audioSetNFT.mint(highestBidder, swarmLink);
        }

        // End the auction
        slot.auctionFinished = true;

        emit AuctionEnded(_audioSlotID, highestBidder, highestBid, _swarmLink);
    }

}