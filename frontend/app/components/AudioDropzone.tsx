'use client'

import { useCallback, useState } from 'react'

interface Props {
  onFile: (file: File) => void
  file: File | null
}

export default function AudioDropzone({ onFile, file }: Props) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('audio/')) onFile(f)
  }, [onFile])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
        dragOver ? 'border-carnation bg-carnation/10' : 'border-gray-600 hover:border-gray-400'
      }`}
    >
      <input
        type="file"
        accept="audio/*"
        onChange={handleChange}
        className="hidden"
        id="audio-upload"
      />
      <label htmlFor="audio-upload" className="cursor-pointer">
        {file ? (
          <div>
            <p className="text-white font-medium">{file.name}</p>
            <p className="text-gray-400 text-sm">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </div>
        ) : (
          <div>
            <p className="text-gray-300">Drop an audio file here or click to browse</p>
            <p className="text-gray-500 text-sm mt-1">MP3, WAV, FLAC, OGG, AAC</p>
          </div>
        )}
      </label>
    </div>
  )
}
