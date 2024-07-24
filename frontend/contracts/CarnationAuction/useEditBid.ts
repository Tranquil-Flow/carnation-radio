import { useWriteContract } from 'wagmi'
import { CarnationAuctionABI } from './abi'
import { carnationAuctionAddress } from '../config'

export function useEditBid() {
  const { writeContract, data, error, isError, isPending, isSuccess } = useWriteContract()

  const editBid = (audioSlotID: bigint) => {
    writeContract({
      address: carnationAuctionAddress,
      CarnationAuctionABI,
      functionName: 'editBid',
      args: [audioSlotID],
    })
  }

  return { editBid, data, error, isError, isPending, isSuccess }
}