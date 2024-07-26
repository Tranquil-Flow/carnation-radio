import React, { useState, useEffect } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const { data: currentAuctionId, isError: isAuctionIdError, isLoading: isAuctionIdLoading, error: auctionIdError } = viewAuctionID() as { data: bigint | undefined, isError: boolean, isLoading: boolean, error: Error | null };
  const { data: auctionData, isError: isAuctionDataError, isLoading: isAuctionDataLoading, error: auctionDataError } = viewAuctions(currentAuctionId || BigInt(0)) as { data: AuctionData | undefined, isError: boolean, isLoading: boolean, error: Error | null };
  const { data: bidData, isError: isBidDataError, isLoading: isBidDataLoading, error: bidDataError } = viewBids(currentAuctionId || BigInt(0), address || '0x') as { data: BidData | undefined, isError: boolean, isLoading: boolean, error: Error | null };

  const { placeBid, isPending: isPlaceBidPending } = usePlaceBid();
  const { editBid, isPending: isEditBidPending } = useEditBid();
  const { endAuction, isPending: isEndAuctionPending } = useEndAuction();
  const { withdrawBid, isPending: isWithdrawBidPending } = useWithdrawBid();

  useEffect(() => {
    console.log('Current Auction ID:', currentAuctionId);
    console.log('Auction Data:', auctionData);
    console.log('Bid Data:', bidData);

    if (isAuctionIdError || isAuctionDataError || isBidDataError) {
      const errorMessage = [
        isAuctionIdError ? `Auction ID Error: ${auctionIdError?.message}` : '',
        isAuctionDataError ? `Auction Data Error: ${auctionDataError?.message}` : '',
        isBidDataError ? `Bid Data Error: ${bidDataError?.message}` : ''
      ].filter(Boolean).join(' | ');
      setError(`Error fetching auction data: ${errorMessage}`);
    } else {
      setError(null);
    }
  }, [currentAuctionId, auctionData, bidData, isAuctionIdError, isAuctionDataError, isBidDataError, auctionIdError, auctionDataError, bidDataError]);

  const handlePlaceBid = () => {
    console.log('Placing bid:', currentAuctionId, bidAmount);
    if (currentAuctionId) {
      placeBid(currentAuctionId, bidAmount);
    } else {
      console.error('Cannot place bid: currentAuctionId is undefined');
    }
  };

  const handleEditBid = () => {
    console.log('Editing bid:', currentAuctionId, bidAmount);
    if (currentAuctionId) {
      editBid(currentAuctionId, bidAmount);
    } else {
      console.error('Cannot edit bid: currentAuctionId is undefined');
    }
  };

  const handleEndAuction = () => {
    console.log('Ending auction:', currentAuctionId);
    if (currentAuctionId) {
      endAuction(currentAuctionId);
    } else {
      console.error('Cannot end auction: currentAuctionId is undefined');
    }
  };

  const handleWithdrawBid = () => {
    console.log('Withdrawing bid:', currentAuctionId);
    if (currentAuctionId) {
      withdrawBid(currentAuctionId);
    } else {
      console.error('Cannot withdraw bid: currentAuctionId is undefined');
    }
  };

  if (isAuctionIdLoading || isAuctionDataLoading || isBidDataLoading) {
    return <div>Loading auction data...</div>;
  }

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Carnation Auction Interactions</h2>
      
      {error && <div className="text-red-500 mb-4">{error}</div>}
      {txStatus && <div className="text-green-500 mb-4">{txStatus}</div>}

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
        <button className="btn btn-primary" onClick={handlePlaceBid} disabled={isPlaceBidPending}>
          {isPlaceBidPending ? 'Placing Bid...' : 'Place Bid'}
        </button>
        <button className="btn btn-secondary" onClick={handleEditBid} disabled={isEditBidPending}>
          {isEditBidPending ? 'Editing Bid...' : 'Edit Bid'}
        </button>
        <button className="btn btn-accent" onClick={handleEndAuction} disabled={isEndAuctionPending}>
          {isEndAuctionPending ? 'Ending Auction...' : 'End Auction'}
        </button>
        <button className="btn btn-ghost" onClick={handleWithdrawBid} disabled={isWithdrawBidPending}>
          {isWithdrawBidPending ? 'Withdrawing Bid...' : 'Withdraw Bid'}
        </button>
      </div>

      <div className="mb-4">
        <h3 className="text-xl font-semibold">Current Auction Info</h3>
        <p>Current Auction ID: {currentAuctionId?.toString() ?? 'N/A'}</p>
        {auctionData ? (
          <div>
            <p>Start Time: {auctionData.auctionStartTime ? new Date(Number(auctionData.auctionStartTime) * 1000).toLocaleString() : 'N/A'}</p>
            <p>Highest Bid: {auctionData.highestBid ? `${auctionData.highestBid.toString()} ETH` : 'N/A'}</p>
            <p>Highest Bidder: {auctionData.highestBidder || 'N/A'}</p>
          </div>
        ) : (
          <p>No auction data available</p>
        )}
      </div>

      <div>
        <h3 className="text-xl font-semibold">Your Bid Info</h3>
        {bidData ? (
          <div>
            <p>Your Bid Amount: {bidData.bidAmount ? `${bidData.bidAmount.toString()} ETH` : 'N/A'}</p>
            <p>Bid Withdrawn: {bidData.bidWithdrawn !== undefined ? (bidData.bidWithdrawn ? 'Yes' : 'No') : 'N/A'}</p>
            <p>Winning Bid: {bidData.winningBid !== undefined ? (bidData.winningBid ? 'Yes' : 'No') : 'N/A'}</p>
          </div>
        ) : (
          <p>No bid data available</p>
        )}
      </div>
    </div>
  );
}