import { useWriteContract } from 'wagmi'
import { CarnationAuctionABI } from './abi'
import { carnationAuctionAddress } from '../config'

export function useEndAuction() {
  const { writeContract, data, error, isPending, isSuccess } = useWriteContract()

  const endAuction = (audioSlotID: bigint) => {
    writeContract({
      address: carnationAuctionAddress,
      abi: CarnationAuctionABI,
      functionName: 'endAuction',
      args: [audioSlotID],
    })
  }

  return { endAuction, data, error, isPending, isSuccess }
}