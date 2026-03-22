'use client'

interface Props {
  state: 'idle' | 'listening' | 'revealed'
  message: string
}

export default function MessageReveal({ state, message }: Props) {
  if (state === 'idle') return null

  return (
    <div className="mt-4">
      {state === 'listening' && (
        <div className="flex items-center gap-2 text-gray-400">
          <span className="loading loading-dots loading-sm"></span>
          <span>Listening for hidden message...</span>
        </div>
      )}
      {state === 'revealed' && (
        <div className="card bg-surface-card border border-carnation/30 animate-[fadeIn_0.5s_ease-in]">
          <div className="card-body">
            <h3 className="card-title text-carnation text-sm">Decoded Message</h3>
            <p className="text-white whitespace-pre-wrap" data-testid="decoded-message">{message}</p>
          </div>
        </div>
      )}
    </div>
  )
}
