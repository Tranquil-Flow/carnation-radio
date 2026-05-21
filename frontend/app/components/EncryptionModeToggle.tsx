'use client'

interface Props {
  mode: 'password' | 'wallet'
  onChange: (mode: 'password' | 'wallet') => void
}

export default function EncryptionModeToggle({ mode, onChange }: Props) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onChange('password')}
        className={`btn btn-sm ${mode === 'password' ? 'btn-primary' : 'btn-ghost'}`}
      >
        Password
      </button>
      <button
        onClick={() => onChange('wallet')}
        className={`btn btn-sm ${mode === 'wallet' ? 'btn-primary' : 'btn-ghost'}`}
      >
        Wallet
      </button>
    </div>
  )
}
