// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AudioSetNFT.sol";

// TODO: Add events

contract Auction is ReentrancyGuard {

    uint public auctionLength;

    AudioSetNFT public audioSetNFT;

    error ETHTransferInFailed();
    error ETHTransferOutFailed();
    error AuctionAlreadyStarted();
    error AuctionNotEnded();
    error AuctionAlreadyEnded();

    struct AudioSlot {
        uint audioSlotID;
        uint auctionStartTime;
        bool auctionFinished;
    }

    AudioSlot[] public audioSlots;

    constructor(
        uint _auctionLength,
        address _nftAddress
    ) public {
        // Define state variables
        auctionLength = _auctionLength;
        audioSetNFT = AudioSetNFT(_nftAddress);


    }

    function placeBid(uint _audioSlotID) public payable nonReentrant {
        // Add bid to bid list for the audio slot

        // Transfer the bid amount to the contract
        (bool success, ) = recipient.call{value: msg.value}("");
        if (!success) {revert(ETHTransferInFailed());}

        // Return the previous bidder's funds if they are not the streamer
        if (musicSlots[_audioSlotID].bidder != streamer) {
            (bool success, ) = musicSlots[_audioSlotID].bidder.call{value: musicSlots[_audioSlotID].highestBidAmount}("");
            if (!success) {revert(ETHTransferOutFailed());}
        }
    }

    function removeBid(uint _audioSlotID) public nonReentrant {
        // Add bid to bid list for the audio slot

        // Transfer the bid amount back to the bidder
        (bool success, ) = msg.sender.call{value: musicSlots[highestBidder].highestBidAmount}("");
        if (!success) {revert ETHTransferOutFailed();}
    }

    function startAuction(uint _audioSlotID) public {
        // Check if the auction has already started
        if (block.timestamp > audioSlots[_audioSlotID].auctionStartTime + auctionLength) {revert AuctionAlreadyStarted();}

        // Set the auction start time
        audioSlots[_audioSlotID].auctionStartTime = block.timestamp;
    }

    function endAuction(uint _audioSlotID) public {
        // Check if the auction has ended
        if (block.timestamp < audioSlots[_audioSlotID].auctionStartTime + auctionLength) {revert AuctionNotEnded();}

        // Check if endAuction has already been called
        if (audioSlots[_audioSlotID].auctionFinished) {revert AuctionAlreadyEnded();}

        // Get highest bidder
        address highestBidder;

        // Mint the NFT to the highest bidder
        audioSetNFT.mint(highestBidder);

        uint swarmHostingCost;
        
        // Implement Swarm hosting logic here 

        // End the auction
        audioSlots[_audioSlotID].auctionFinished = true;
    }

}