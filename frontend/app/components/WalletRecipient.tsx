'use client'

interface ResolvedENS {
  address: string
  name: string | null
  avatar: string | null
}

interface Props {
  value: string
  onChange: (v: string) => void
  resolved: ResolvedENS | null
}

export default function WalletRecipient({ value, onChange, resolved }: Props) {
  return (
    <div className="form-control w-full">
      <label className="label">
        <span className="label-text text-gray-300">Recipient (ENS or 0x address)</span>
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="vitalik.eth or 0x..."
        className="input input-bordered w-full bg-surface-card border-gray-600 text-white placeholder-gray-500"
      />
      {resolved && (
        <div className="flex items-center gap-2 mt-2 p-2 bg-surface-card rounded">
          {resolved.avatar && (
            <img src={resolved.avatar} alt="" className="w-6 h-6 rounded-full" />
          )}
          <span className="text-sm text-gray-300">
            {resolved.name || resolved.address.slice(0, 8) + '...'}
          </span>
          <span className="text-xs text-success">Resolved</span>
        </div>
      )}
    </div>
  )
}
