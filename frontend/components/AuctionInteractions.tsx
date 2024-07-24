import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { useEditBid } from '../contracts/CarnationAuction/useEditBid';
import { useEndAuction } from '../contracts/CarnationAuction/useEndAuction';
import { usePlaceBid } from '../contracts/CarnationAuction/usePlaceBid';
import { useWithdrawBid } from '../contracts/CarnationAuction/useWithdrawBid';
import { viewAuctionID } from '../contracts/CarnationAuction/viewAuctionID';
import { viewAuctions } from '../contracts/CarnationAuction/viewAuctions';
import { viewBids } from '../contracts/CarnationAuction/viewBids';

interface AuctionData {
    auctionStartTime: bigint;
    highestBid: bigint;
    highestBidder: string;
  }
  
  interface BidData {
    bidAmount: bigint;
    bidWithdrawn: boolean;
    winningBid: boolean;
  }

export function AuctionInteractions() {
  const { address } = useAccount();
  const [bidAmount, setBidAmount] = useState('');
  const [auctionId, setAuctionId] = useState<bigint>(BigInt(0));
  
  const { editBid } = useEditBid();
  const { endAuction } = useEndAuction();
  const { placeBid } = usePlaceBid();
  const { withdrawBid } = useWithdrawBid();
  const { data: currentAuctionId } = viewAuctionID() as { data: bigint | undefined };
  const { data: auctionData } = viewAuctions(auctionId) as { data: AuctionData | undefined };
  const { data: bidData } = viewBids(auctionId, address || '0x') as { data: BidData | undefined };

  const handlePlaceBid = () => {
    if (currentAuctionId) {
      placeBid(currentAuctionId, bidAmount);
    }
  };

  const handleEditBid = () => {
    if (currentAuctionId) {
      editBid(currentAuctionId, bidAmount);
    }
  };

  const handleEndAuction = () => {
    if (currentAuctionId) {
      endAuction(currentAuctionId);
    }
  };

  const handleWithdrawBid = () => {
    if (currentAuctionId) {
      withdrawBid(currentAuctionId);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Carnation Auction Interactions</h2>
      
      <div className="mb-4">
        <input
          type="text"
          placeholder="Bid amount in ETH"
          className="input input-bordered w-full max-w-xs"
          value={bidAmount}
          onChange={(e) => setBidAmount(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button className="btn btn-primary" onClick={handlePlaceBid}>Place Bid</button>
        <button className="btn btn-secondary" onClick={handleEditBid}>Edit Bid</button>
        <button className="btn btn-accent" onClick={handleEndAuction}>End Auction</button>
        <button className="btn btn-ghost" onClick={handleWithdrawBid}>Withdraw Bid</button>
      </div>

      <div className="mb-4">
        <h3 className="text-xl font-semibold">Current Auction Info</h3>
        <p>Current Auction ID: {currentAuctionId?.toString()}</p>
        {auctionData && (
          <div>
            <p>Start Time: {new Date(Number(auctionData.auctionStartTime) * 1000).toLocaleString()}</p>
            <p>Highest Bid: {auctionData.highestBid.toString()} ETH</p>
            <p>Highest Bidder: {auctionData.highestBidder}</p>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xl font-semibold">Your Bid Info</h3>
        {bidData && (
          <div>
            <p>Your Bid Amount: {bidData.bidAmount.toString()} ETH</p>
            <p>Bid Withdrawn: {bidData.bidWithdrawn ? 'Yes' : 'No'}</p>
            <p>Winning Bid: {bidData.winningBid ? 'Yes' : 'No'}</p>
          </div>
        )}
      </div>
    </div>
  );
}