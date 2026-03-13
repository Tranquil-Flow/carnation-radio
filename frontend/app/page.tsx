'use client'

import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { sha256 } from '@noble/hashes/sha2.js'
import AudioDropzone from './components/AudioDropzone'
import EncryptionModeToggle from './components/EncryptionModeToggle'
import PasswordInput from './components/PasswordInput'
import WalletRecipient from './components/WalletRecipient'
import EncodeProgress, { type EncodeStage } from './components/EncodeProgress'
import MessageReveal from './components/MessageReveal'
import AudioPlayer from './components/AudioPlayer'
import { encryptMessage, decryptMessage } from '@/lib/crypto'
import { detectVersion, isPasswordMode } from '@/lib/wire'
import { stegoEncode, stegoDecode } from '@/lib/stego'
import { toWav, toMp3 } from '@/lib/transcode'

type Tab = 'encode' | 'decode'

function deriveEmbedKey(passphrase: string): Uint8Array {
  return sha256(new TextEncoder().encode('carnation-embed:' + passphrase))
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('encode')

  // Encode state
  const [encFile, setEncFile] = useState<File | null>(null)
  const [encMessage, setEncMessage] = useState('')
  const [encMode, setEncMode] = useState<'password' | 'wallet'>('password')
  const [encPass, setEncPass] = useState('')
  const [encWallet, setEncWallet] = useState('')
  const [encStage, setEncStage] = useState<EncodeStage>('idle')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [encError, setEncError] = useState<string | null>(null)

  // Decode state
  const [decFile, setDecFile] = useState<File | null>(null)
  const [decPass, setDecPass] = useState('')
  const [decState, setDecState] = useState<'idle' | 'listening' | 'revealed'>('idle')
  const [decMessage, setDecMessage] = useState('')
  const [decError, setDecError] = useState<string | null>(null)
  const [decAudioUrl, setDecAudioUrl] = useState<string | null>(null)

  async function handleEncode() {
    if (!encFile || !encMessage || !encPass) return
    setEncError(null)
    setDownloadUrl(null)

    try {
      setEncStage('transcoding')
      const samples = await toWav(encFile)

      setEncStage('encrypting')
      const messageBytes = new TextEncoder().encode(encMessage)
      const encrypted = await encryptMessage(messageBytes, encPass)

      // Build versioned payload: version byte + encrypted data
      const payload = new Uint8Array(1 + encrypted.length)
      payload[0] = 0x01 // PASSWORD_REPETITION
      payload.set(encrypted, 1)

      const embedKey = deriveEmbedKey(encPass)

      setEncStage('embedding')
      const encoded = await stegoEncode(
        new Float64Array(samples),
        payload,
        embedKey,
      )

      setEncStage('compressing')
      const mp3Blob = await toMp3(new Float64Array(encoded))

      setEncStage('done')
      setDownloadUrl(URL.createObjectURL(mp3Blob))
    } catch (err: any) {
      setEncError(err.message || 'Encoding failed')
      setEncStage('idle')
    }
  }

  async function handleDecode() {
    if (!decFile || !decPass) return
    setDecError(null)
    setDecState('listening')

    try {
      const samples = await toWav(decFile)
      const embedKey = deriveEmbedKey(decPass)

      const rawPayload = await stegoDecode(new Float64Array(samples), embedKey)

      const { version, data } = detectVersion(rawPayload)

      let plaintext: Uint8Array
      if (isPasswordMode(version)) {
        plaintext = await decryptMessage(data, decPass)
      } else {
        throw new Error('Wallet mode decryption not yet supported')
      }

      setDecMessage(new TextDecoder().decode(plaintext))
      setDecState('revealed')
    } catch (err: any) {
      setDecError(err.message || 'Decoding failed')
      setDecState('idle')
    }
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold text-carnation">Carnation Radio</h1>
        <ConnectButton />
      </header>

      {/* Tabs */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="tabs tabs-boxed bg-surface-secondary mb-6">
          <button
            className={`tab ${tab === 'encode' ? 'tab-active !bg-carnation !text-white' : ''}`}
            onClick={() => setTab('encode')}
          >
            Encode
          </button>
          <button
            className={`tab ${tab === 'decode' ? 'tab-active !bg-carnation !text-white' : ''}`}
            onClick={() => setTab('decode')}
          >
            Decode
          </button>
        </div>

        {/* Encode View */}
        {tab === 'encode' && (
          <div className="space-y-4">
            <AudioDropzone onFile={setEncFile} file={encFile} />

            <div className="form-control">
              <label className="label">
                <span className="label-text text-gray-300">Secret Message</span>
              </label>
              <textarea
                value={encMessage}
                onChange={(e) => setEncMessage(e.target.value)}
                placeholder="Type your hidden message..."
                className="textarea textarea-bordered bg-surface-card border-gray-600 text-white placeholder-gray-500 h-24"
              />
            </div>

            <EncryptionModeToggle mode={encMode} onChange={setEncMode} />

            {encMode === 'password' ? (
              <PasswordInput value={encPass} onChange={setEncPass} />
            ) : (
              <WalletRecipient
                value={encWallet}
                onChange={setEncWallet}
                resolved={null}
              />
            )}

            <button
              onClick={handleEncode}
              disabled={!encFile || !encMessage || !encPass || (encStage !== 'idle' && encStage !== 'done')}
              className="btn btn-primary w-full"
            >
              Encode Message
            </button>

            <EncodeProgress stage={encStage} />

            {encError && (
              <div className="alert alert-error">
                <span>{encError}</span>
              </div>
            )}

            {downloadUrl && (
              <a
                href={downloadUrl}
                download="carnation-encoded.mp3"
                className="btn btn-outline btn-success w-full"
              >
                Download Encoded MP3
              </a>
            )}
          </div>
        )}

        {/* Decode View */}
        {tab === 'decode' && (
          <div className="space-y-4">
            <AudioDropzone onFile={(f) => {
              setDecFile(f)
              setDecAudioUrl(URL.createObjectURL(f))
              setDecState('idle')
              setDecMessage('')
              setDecError(null)
            }} file={decFile} />

            <PasswordInput
              value={decPass}
              onChange={setDecPass}
              label="Passphrase (used during encoding)"
            />

            <div className="flex gap-2">
              <button
                onClick={handleDecode}
                disabled={!decFile || !decPass || decState === 'listening'}
                className="btn btn-primary flex-1"
              >
                Decode Message
              </button>
            </div>

            {decAudioUrl && (
              <AudioPlayer src={decAudioUrl} />
            )}

            {decError && (
              <div className="alert alert-error">
                <span>{decError}</span>
              </div>
            )}

            <MessageReveal state={decState} message={decMessage} />
          </div>
        )}
      </div>
    </main>
  )
}
