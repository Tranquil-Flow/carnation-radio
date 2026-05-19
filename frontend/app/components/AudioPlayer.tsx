'use client'

import { forwardRef } from 'react'

interface Props {
  src: string | null
  onPlay?: () => void
  onReady?: () => void
  controlsEnabled?: boolean
}

const AudioPlayer = forwardRef<HTMLAudioElement, Props>(({ src, onPlay, onReady, controlsEnabled = true }, ref) => {
  if (!src) return null

  return (
    <div className="w-full">
      <audio
        ref={ref}
        src={src}
        preload="auto"
        controls={controlsEnabled}
        onPlay={onPlay}
        onLoadedMetadata={onReady}
        onCanPlay={onReady}
        className="w-full"
        style={{ filter: 'invert(1)' }}
      />
    </div>
  )
})

AudioPlayer.displayName = 'AudioPlayer'
export default AudioPlayer
