// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// TODO: Add events

contract Auction is ReentrancyGuard {

    address public streamer;

    error InputLessThanHighestBid();
    error ETHTransferInFailed();
    error ETHTransferOutFailed();

    struct MusicSlot {
        uint audioSlotID;
        string musicName;
        uint timePlaying;
        uint256 highestBidAmount;
        address bidder;
    }

    MusicSlot[] public musicSlots;

    constructor() public {

        // Define payment split variables

    }

    function placeBid(uint _audioSlotID) public payable nonReentrant {
        // Check if the bid is higher than the current highest bid
        if (msg.value <= musicSlots[_audioSlotID].highestBidAmount) {revert InputLessThanHighestBid();}

        // Transfer the bid amount to the contract
        (bool success, ) = recipient.call{value: msg.value}("");
        if (!success) {revert(ETHTransferInFailed());}

        // Return the previous bidder's funds if they are not the streamer
        if (musicSlots[_audioSlotID].bidder != streamer) {
            (bool success, ) = musicSlots[_audioSlotID].bidder.call{value: musicSlots[_audioSlotID].highestBidAmount}("");
            if (!success) {revert(ETHTransferOutFailed());}
        }
    
        // Update the highest bid amount and bidder
        musicSlots[_audioSlotID].highestBidAmount = msg.value;
        musicSlots[_audioSlotID].bidder = msg.sender;
    }

    function removeBid()

}