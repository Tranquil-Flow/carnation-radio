import { useWriteContract } from 'wagmi'
import { CarnationAuctionABI } from './abi'
import { carnationAuctionAddress } from '../config'
import { parseEther } from 'viem'

export function usePlaceBid() {
  const { writeContract, data, error, isPending, isSuccess } = useWriteContract()

  const placeBid = (audioSlotID: bigint, bidAmount: string) => {
    writeContract({
      address: carnationAuctionAddress,
      abi: CarnationAuctionABI,
      functionName: 'placeBid',
      args: [audioSlotID],
      value: parseEther(bidAmount),
    })
  }

  return { placeBid, data, error, isPending, isSuccess }
}