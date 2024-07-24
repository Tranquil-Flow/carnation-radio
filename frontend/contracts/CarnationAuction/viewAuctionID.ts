import { useReadContract } from 'wagmi'
import { CarnationAuctionABI } from './abi'
import { carnationAuctionAddress } from '../config'

export function viewAuctionID() {
  return useReadContract({
    address: carnationAuctionAddress,
    abi: CarnationAuctionABI,
    functionName: 'auctionID',
  })
}