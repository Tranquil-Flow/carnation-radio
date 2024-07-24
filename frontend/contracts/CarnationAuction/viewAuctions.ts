import { useReadContract } from 'wagmi'
import { CarnationAuctionABI } from './abi'
import { carnationAuctionAddress } from '../config'

export function viewAuctions(auctionID: bigint) {
  return useReadContract({
    address: carnationAuctionAddress,
    abi: CarnationAuctionABI,
    functionName: 'auctions',
    args: [auctionID],
  })
}