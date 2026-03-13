'use client'

import { useRef } from 'react'

interface Props {
  src: string | null
  onPlay?: () => void
}

export default function AudioPlayer({ src, onPlay }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)

  if (!src) return null

  return (
    <div className="w-full">
      <audio
        ref={audioRef}
        src={src}
        controls
        onPlay={onPlay}
        className="w-full"
        style={{ filter: 'invert(1)' }}
      />
    </div>
  )
}
