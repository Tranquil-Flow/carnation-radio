'use client'

import { forwardRef } from 'react'

interface Props {
  src: string | null
  onPlay?: () => void
}

const AudioPlayer = forwardRef<HTMLAudioElement, Props>(({ src, onPlay }, ref) => {
  if (!src) return null

  return (
    <div className="w-full">
      <audio
        ref={ref}
        src={src}
        controls
        onPlay={onPlay}
        className="w-full"
        style={{ filter: 'invert(1)' }}
      />
    </div>
  )
})

AudioPlayer.displayName = 'AudioPlayer'
export default AudioPlayer
