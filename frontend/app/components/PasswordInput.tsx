'use client'

interface Props {
  value: string
  onChange: (v: string) => void
  label?: string
}

export default function PasswordInput({ value, onChange, label = 'Passphrase' }: Props) {
  const strength = value.length === 0 ? null : value.length < 8 ? 'weak' : value.length < 16 ? 'medium' : 'strong'
  const strengthColor = strength === 'weak' ? 'text-error' : strength === 'medium' ? 'text-warning' : 'text-success'

  return (
    <div className="form-control w-full">
      <label className="label">
        <span className="label-text text-gray-300">{label}</span>
        {strength && <span className={`label-text-alt ${strengthColor}`}>{strength}</span>}
      </label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter passphrase..."
        className="input input-bordered w-full bg-surface-card border-gray-600 text-white placeholder-gray-500"
      />
    </div>
  )
}
