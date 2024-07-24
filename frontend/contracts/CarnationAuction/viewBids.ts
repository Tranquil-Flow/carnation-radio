import { useReadContract } from 'wagmi'
import { CarnationAuctionABI } from './abi'
import { carnationAuctionAddress } from '../config'

export function viewBids(auctionID: bigint, bidder: `0x${string}`) {
  return useReadContract({
    address: carnationAuctionAddress,
    abi: CarnationAuctionABI,
    functionName: 'bids',
    args: [auctionID, bidder],
  })
}