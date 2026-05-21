'use client'

export type EncodeStage = 'idle' | 'transcoding' | 'encrypting' | 'embedding' | 'compressing' | 'done'

interface Props {
  stage: EncodeStage
}

const STEPS: { key: EncodeStage; label: string }[] = [
  { key: 'transcoding', label: 'Transcoding audio' },
  { key: 'encrypting', label: 'Encrypting message' },
  { key: 'embedding', label: 'Embedding in audio' },
  { key: 'compressing', label: 'Rendering encoded WAV' },
]

export default function EncodeProgress({ stage }: Props) {
  if (stage === 'idle') return null

  const activeIdx = stage === 'done' ? STEPS.length : STEPS.findIndex(s => s.key === stage)

  return (
    <ul className="steps steps-vertical w-full">
      {STEPS.map((step, i) => (
        <li
          key={step.key}
          className={`step ${i < activeIdx ? 'step-primary' : ''} ${i === activeIdx ? 'step-primary' : ''}`}
        >
          <span className={`text-sm ${i === activeIdx ? 'text-carnation animate-pulse' : i < activeIdx ? 'text-gray-300' : 'text-gray-500'}`}>
            {step.label}
            {i === activeIdx && stage !== 'done' && '...'}
            {i < activeIdx && ' ✓'}
          </span>
        </li>
      ))}
    </ul>
  )
}
