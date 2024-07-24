import { useWriteContract } from 'wagmi'
import { CarnationAuctionABI } from './abi'
import { carnationAuctionAddress } from '../config'

export function useWithdrawBid() {
  const { writeContract, data, error, isPending, isSuccess } = useWriteContract()

  const withdrawBid = (audioSlotID: bigint) => {
    writeContract({
      address: carnationAuctionAddress,
      abi: CarnationAuctionABI,
      functionName: 'withdrawBid',
      args: [audioSlotID],
    })
  }

  return { withdrawBid, data, error, isPending, isSuccess }
}