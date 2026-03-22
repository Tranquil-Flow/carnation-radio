'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useSignMessage, useWalletClient } from 'wagmi'
import { sha256 } from '@noble/hashes/sha2.js'
import AudioDropzone from './components/AudioDropzone'
import EncryptionModeToggle from './components/EncryptionModeToggle'
import PasswordInput from './components/PasswordInput'
import EncodeProgress, { type EncodeStage } from './components/EncodeProgress'
import MessageReveal from './components/MessageReveal'
import AudioPlayer from './components/AudioPlayer'
import { encryptMessage, decryptMessage } from '@/lib/crypto'
import { formatEncodeError } from '@/lib/errors'
import { stegoEncode, stegoDecode } from '@/lib/stego'
import { toWav, toMp3 } from '@/lib/transcode'
import { maxMessageBytes, minDurationSeconds, getAudioDuration } from '@/lib/capacity'
import {
  CARNATION_DERIVE_MESSAGE,
  derivePrivateKeyHex,
  getPublicKeyHex,
  walletDecrypt,
} from '@/lib/wallet-crypto'
import { encryptToAddress, parseClaimLink } from '@/lib/encrypt-to-address'
import { lookupRegistry, registerSelf } from '@/lib/registry'
import { detectVersion, isClaimMode, parseClaimPayload } from '@/lib/wire'

type Tab = 'encode' | 'decode'

function deriveEmbedKey(secret: string): Uint8Array {
  return sha256(new TextEncoder().encode('carnation-embed:' + secret))
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('encode')
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { data: walletClient } = useWalletClient()

  // Encode state
  const [encFile, setEncFile] = useState<File | null>(null)
  const [encMessage, setEncMessage] = useState('')
  const [encMode, setEncMode] = useState<'password' | 'wallet'>('password')
  const [encPass, setEncPass] = useState('')
  const [encRecipientAddress, setEncRecipientAddress] = useState('')
  const [encStage, setEncStage] = useState<EncodeStage>('idle')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [encError, setEncError] = useState<string | null>(null)
  const [encErrorDetails, setEncErrorDetails] = useState<string | null>(null)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [encCapacity, setEncCapacity] = useState<number | null>(null)
  const [encDuration, setEncDuration] = useState<number | null>(null)

  // Claim link state (Mode B encryption)
  const [claimLink, setClaimLink] = useState<string | null>(null)
  const [claimCopied, setClaimCopied] = useState(false)

  // Recipient registry status
  const [recipientStatus, setRecipientStatus] = useState<'idle' | 'checking' | 'registered' | 'unregistered'>('idle')

  // Claim link decode state (Mode B recipient)
  const [claimKeyInput, setClaimKeyInput] = useState('')
  const [pendingClaimKey, setPendingClaimKey] = useState<Uint8Array | null>(null)

  // Decode state
  const [decMethod, setDecMethod] = useState<'upload' | 'listen'>('upload')
  const [decFile, setDecFile] = useState<File | null>(null)
  const [decPass, setDecPass] = useState('')
  const [decMode, setDecMode] = useState<'password' | 'wallet'>('password')
  const [decState, setDecState] = useState<'idle' | 'listening' | 'revealed'>('idle')
  const [decMessage, setDecMessage] = useState('')
  const [decError, setDecError] = useState<string | null>(null)
  const [decAudioUrl, setDecAudioUrl] = useState<string | null>(null)

  // Registration prompt state
  const [registrationStatus, setRegistrationStatus] = useState<'idle' | 'prompting' | 'registering' | 'done' | 'skipped'>('idle')
  const [registrationError, setRegistrationError] = useState<string | null>(null)

  // Cached wallet identity (derived from signature, persists for session)
  const [walletPubKey, setWalletPubKey] = useState<string | null>(null)
  const [walletSig, setWalletSig] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Live decode state
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [liveDecoding, setLiveDecoding] = useState(false)
  const [liveProgress, setLiveProgress] = useState(0)

  // Clear cached wallet identity when account changes
  useEffect(() => {
    setWalletPubKey(null)
    setWalletSig(null)
  }, [address])

  // Compute capacity when encode file or mode changes
  useEffect(() => {
    if (!encFile) {
      setEncCapacity(null)
      setEncDuration(null)
      return
    }
    getAudioDuration(encFile)
      .then(dur => {
        setEncDuration(dur)
        setEncCapacity(maxMessageBytes(dur, encMode))
      })
      .catch(() => {
        setEncCapacity(null)
        setEncDuration(null)
      })
  }, [encFile, encMode])

  // Cleanup AudioContext on unmount or tab switch
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
      }
    }
  }, [tab])

  // Check URL fragment for claim link on page load
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (hash.includes('claim')) {
      const parsed = parseClaimLink(hash)
      if (parsed) {
        setPendingClaimKey(parsed.key)
        setTab('decode')
        setDecMode('password') // Claim mode doesn't need wallet
      }
    }
  }, [])

  // Check registry when recipient address changes
  useEffect(() => {
    if (encMode !== 'wallet' || !encRecipientAddress) {
      setRecipientStatus('idle')
      return
    }
    // Validate it looks like an address (0x + 40 hex chars) or ENS name
    const isAddr = /^0x[0-9a-fA-F]{40}$/.test(encRecipientAddress)
    const isEns = encRecipientAddress.endsWith('.eth')
    if (!isAddr && !isEns) {
      setRecipientStatus('idle')
      return
    }

    setRecipientStatus('checking')
    lookupRegistry(encRecipientAddress)
      .then(pubkey => {
        setRecipientStatus(pubkey ? 'registered' : 'unregistered')
      })
      .catch(() => {
        setRecipientStatus('unregistered')
      })
  }, [encRecipientAddress, encMode])

  /** Sign canonical message and cache the result. Returns { privHex, pubHex }. */
  async function getWalletKeys(): Promise<{ privHex: string; pubHex: string }> {
    let sig = walletSig
    if (!sig) {
      sig = await signMessageAsync({ message: CARNATION_DERIVE_MESSAGE })
      setWalletSig(sig)
    }
    const privHex = derivePrivateKeyHex(sig)
    const pubHex = getPublicKeyHex(privHex)
    if (!walletPubKey) setWalletPubKey(pubHex)
    return { privHex, pubHex }
  }

  async function handleGetId() {
    try {
      await getWalletKeys()
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.includes('User rejected')) return
      console.error('Failed to derive wallet ID:', err)
    }
  }

  async function handleCopyId() {
    if (!walletPubKey) return
    await navigator.clipboard.writeText(walletPubKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleEncode() {
    if (!encFile || !encMessage) return
    if (encMode === 'password' && !encPass) return
    if (encMode === 'wallet' && (!isConnected || !encRecipientAddress)) return
    setEncError(null)
    setEncErrorDetails(null)
    setShowErrorDetails(false)
    setDownloadUrl(null)
    setClaimLink(null)

    try {
      setEncStage('transcoding')
      const samples = await toWav(encFile)

      setEncStage('encrypting')
      const messageBytes = new TextEncoder().encode(encMessage)

      let encrypted: Uint8Array
      let embedKey: Uint8Array

      if (encMode === 'wallet') {
        const { privHex, pubHex } = await getWalletKeys()
        const result = await encryptToAddress(encRecipientAddress, messageBytes, privHex, pubHex)
        encrypted = result.payload  // already includes version byte
        // Embed key derived from recipient address — both parties can compute this
        embedKey = deriveEmbedKey(encRecipientAddress.toLowerCase())

        if (result.claimLink) {
          setClaimLink(result.claimLink)
        }
      } else {
        encrypted = await encryptMessage(messageBytes, encPass)
        embedKey = deriveEmbedKey(encPass)
      }

      // Rust engine adds version byte + framing internally via build_payload()
      setEncStage('embedding')
      const encoded = await stegoEncode(
        new Float64Array(samples),
        encrypted,
        embedKey,
      )

      setEncStage('compressing')
      const mp3Blob = await toMp3(new Float64Array(encoded))

      setEncStage('done')
      setDownloadUrl(URL.createObjectURL(mp3Blob))
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setEncStage('idle')
        return
      }
      console.error('Encode pipeline error:', err)
      const raw = err?.message || String(err) || 'Encoding failed'
      const { message, details } = formatEncodeError(raw)
      setEncError(message)
      setEncErrorDetails(details)
      setEncStage('idle')
    }
  }

  async function handleDecode() {
    if (!decFile) return
    if (pendingClaimKey === null && decMode === 'password' && !decPass) return
    if (pendingClaimKey === null && decMode === 'wallet' && !isConnected) return
    setDecError(null)
    setDecState('listening')

    try {
      let embedKey: Uint8Array
      let plaintext: Uint8Array

      // Check for claim link mode (Mode B recipient)
      if (pendingClaimKey) {
        const parsed = parseClaimLink(claimKeyInput || window.location.hash)
        if (!parsed) throw new Error('Invalid claim link')
        embedKey = deriveEmbedKey(parsed.forAddress.toLowerCase())
        const samples = await toWav(decFile)
        const rawPayload = await stegoDecode(new Float64Array(samples), embedKey)
        const { version, data } = detectVersion(rawPayload)

        if (isClaimMode(version)) {
          const { nonce, ciphertext } = parseClaimPayload(data)
          const cryptoKey = await crypto.subtle.importKey('raw', pendingClaimKey, 'AES-GCM', false, ['decrypt'])
          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: nonce, tagLength: 128 },
            cryptoKey, ciphertext,
          )
          plaintext = new Uint8Array(decrypted)
        } else {
          throw new Error('This audio does not contain a claim-mode message')
        }
      } else if (decMode === 'wallet') {
        const { privHex } = await getWalletKeys()
        // Embed key derived from recipient's address (same as what sender used)
        if (!address) throw new Error('Wallet not connected')
        embedKey = deriveEmbedKey(address.toLowerCase())
        const samples = await toWav(decFile)
        const rawPayload = await stegoDecode(new Float64Array(samples), embedKey)
        const { data } = detectVersion(rawPayload)
        plaintext = await walletDecrypt(privHex, data)
      } else {
        embedKey = deriveEmbedKey(decPass)
        const samples = await toWav(decFile)
        const rawPayload = await stegoDecode(new Float64Array(samples), embedKey)
        const { data } = detectVersion(rawPayload)
        plaintext = await decryptMessage(data, decPass)
      }

      setDecMessage(new TextDecoder().decode(plaintext))
      setDecState('revealed')
      setRegistrationStatus('idle')
      setRegistrationError(null)

      // Trigger registration prompt
      if (pendingClaimKey) {
        // Mode B (claim link): always offer registration (wallet may not be connected)
        setRegistrationStatus('prompting')
      } else if (decMode === 'wallet' && address) {
        // Mode A (wallet): check if already registered
        try {
          const registered = await lookupRegistry(address)
          if (!registered) {
            setRegistrationStatus('prompting')
          }
          // else: already registered, no prompt
        } catch {
          // Registry check failed, silently skip prompt
        }
      }
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setDecState('idle')
        return
      }
      console.error('Decode pipeline error:', err)
      setDecError(err?.message || String(err) || 'Decoding failed')
      setDecState('idle')
    }
  }

  async function handleLiveDecode() {
    if (!audioRef.current) return
    // Skip if worklet is already connected
    if (audioCtxRef.current) return

    setDecError(null)
    setDecState('listening')

    try {
      let embedKey: Uint8Array
      let walletPrivHex: string | undefined

      if (decMode === 'wallet') {
        const { privHex } = await getWalletKeys()
        if (!address) throw new Error('Wallet not connected')
        embedKey = deriveEmbedKey(address.toLowerCase())
        walletPrivHex = privHex
      } else {
        embedKey = deriveEmbedKey(decPass)
      }

      const duration = audioRef.current.duration || 0
      const totalFrames = Math.floor(duration * 44100 / 1024)

      // Force 44100 Hz to match stego engine sample rate
      const ctx = new AudioContext({ sampleRate: 44100 })
      audioCtxRef.current = ctx

      await ctx.audioWorklet.addModule('/worklet/decode-processor.js')
      const workletNode = new AudioWorkletNode(ctx, 'decode-processor')
      const source = ctx.createMediaElementSource(audioRef.current)
      source.connect(workletNode)
      workletNode.connect(ctx.destination)

      workletNode.port.postMessage({
        type: 'init',
        key: Array.from(embedKey),
        totalFrames,
        wasmUrl: '/wasm/carnation_stego.js',
      })

      workletNode.port.onmessage = async (event: MessageEvent) => {
        if (event.data.type === 'progress') {
          setLiveProgress(event.data.value)
        } else if (event.data.type === 'decoded') {
          const rawPayload = new Uint8Array(event.data.payload)
          try {
            const { data } = detectVersion(rawPayload)
            let plaintext: Uint8Array
            if (decMode === 'wallet' && walletPrivHex) {
              plaintext = await walletDecrypt(walletPrivHex, data)
            } else {
              plaintext = await decryptMessage(data, decPass)
            }
            setDecMessage(new TextDecoder().decode(plaintext))
            setDecState('revealed')
          } catch (err: any) {
            const raw = err?.message || 'Decryption failed'
            const { message } = formatEncodeError(raw)
            setDecError(message)
            setDecState('idle')
          }
          setLiveDecoding(false)
        }
      }
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setDecState('idle')
        setLiveDecoding(false)
        return
      }
      console.error('Live decode error:', err)
      setDecError(err?.message || 'Live decode failed')
      setDecState('idle')
      setLiveDecoding(false)
    }
  }

  async function handleRegister() {
    if (!walletClient || !walletPubKey) return
    setRegistrationStatus('registering')
    setRegistrationError(null)
    try {
      await registerSelf(walletClient, walletPubKey)
      setRegistrationStatus('done')
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setRegistrationStatus('prompting')
        return
      }
      setRegistrationError(err?.message || 'Registration failed')
      setRegistrationStatus('prompting')
    }
  }

  const encMessageBytes = new TextEncoder().encode(encMessage).length
  const neededDuration = encMessageBytes > 0 ? minDurationSeconds(encMessageBytes, encMode) : null

  const encodeDisabled =
    !encFile || !encMessage ||
    (encMode === 'password' ? !encPass : (!isConnected || !encRecipientAddress)) ||
    (encStage !== 'idle' && encStage !== 'done')

  const decodeDisabled =
    (decMethod === 'upload' && !decFile) ||
    (!pendingClaimKey && (decMode === 'password' ? !decPass : !isConnected)) ||
    decState === 'listening'

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
            data-testid="tab-encode"
          >
            Encode
          </button>
          <button
            className={`tab ${tab === 'decode' ? 'tab-active !bg-carnation !text-white' : ''}`}
            onClick={() => setTab('decode')}
            data-testid="tab-decode"
          >
            Decode
          </button>
        </div>

        {/* Encode View */}
        {tab === 'encode' && (
          <div className="space-y-4">
            <AudioDropzone onFile={setEncFile} file={encFile} testId="audio-upload-encode" />

            {/* Capacity info */}
            {encFile && encCapacity !== null && (
              <div className="text-sm text-gray-400">
                {encDuration !== null && (
                  <span>{Math.round(encDuration)}s track</span>
                )}
                {' — '}
                <span>
                  can hold <strong className="text-gray-200">~{encCapacity} characters</strong>
                </span>
                {neededDuration !== null && encDuration !== null && neededDuration > encDuration && (
                  <span className="text-amber-400 ml-2">
                    (your message needs ~{neededDuration}s)
                  </span>
                )}
              </div>
            )}

            <div className="form-control">
              <label className="label">
                <span className="label-text text-gray-300">Secret Message</span>
                {encMessage && (
                  <span className="label-text-alt text-gray-500">
                    {encMessageBytes} bytes
                  </span>
                )}
              </label>
              <textarea
                value={encMessage}
                onChange={(e) => setEncMessage(e.target.value)}
                placeholder="Type your hidden message..."
                className="textarea textarea-bordered bg-surface-card border-gray-600 text-white placeholder-gray-500 h-24"
              />
            </div>

            <EncryptionModeToggle mode={encMode} onChange={(mode) => {
              setEncMode(mode)
              if (mode === 'wallet') setEncPass('')
              if (mode === 'password') setEncRecipientAddress('')
            }} />

            {encMode === 'password' ? (
              <PasswordInput value={encPass} onChange={setEncPass} />
            ) : (
              <div className="space-y-3">
                {!isConnected && (
                  <div className="p-3 bg-surface-card border border-gray-600 rounded-lg text-center">
                    <p className="text-sm text-gray-400 mb-2">Connect your wallet to send encrypted messages</p>
                    <ConnectButton />
                  </div>
                )}
                {isConnected && (
                  <div className="form-control w-full">
                    <label className="label">
                      <span className="label-text text-gray-300">Recipient Address or ENS</span>
                    </label>
                    <input
                      type="text"
                      value={encRecipientAddress}
                      onChange={(e) => setEncRecipientAddress(e.target.value.trim())}
                      placeholder="0x... or name.eth"
                      className="input input-bordered w-full bg-surface-card border-gray-600 text-white placeholder-gray-500 font-mono text-sm"
                    />
                    {recipientStatus === 'checking' && (
                      <label className="label">
                        <span className="label-text-alt text-gray-400">Checking registry...</span>
                      </label>
                    )}
                    {recipientStatus === 'registered' && (
                      <label className="label">
                        <span className="label-text-alt text-success">
                          ✓ Registered — direct encrypted message
                        </span>
                      </label>
                    )}
                    {recipientStatus === 'unregistered' && (
                      <label className="label">
                        <span className="label-text-alt text-warning">
                          ⚠ Not registered — a claim link will be generated
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleEncode}
              disabled={encodeDisabled}
              className="btn btn-primary w-full"
              data-testid="btn-encode"
            >
              {encMode === 'wallet' && !isConnected ? 'Connect Wallet to Encode' : 'Encode Message'}
            </button>

            <EncodeProgress stage={encStage} />

            {encError && (
              <div className="alert alert-error flex-col items-start">
                <span>{encError}</span>
                {encErrorDetails && (
                  <>
                    <button
                      onClick={() => setShowErrorDetails(!showErrorDetails)}
                      className="text-xs underline opacity-70 hover:opacity-100"
                    >
                      {showErrorDetails ? 'Hide details' : 'Show details'}
                    </button>
                    {showErrorDetails && (
                      <code className="text-xs opacity-70 mt-1 break-all">{encErrorDetails}</code>
                    )}
                  </>
                )}
              </div>
            )}

            {downloadUrl && (
              <a
                href={downloadUrl}
                download="carnation-encoded.mp3"
                className="btn btn-outline btn-success w-full"
                data-testid="download-link"
              >
                Download Encoded MP3
              </a>
            )}

            {claimLink && (
              <div className="p-4 bg-surface-card border border-amber-600/50 rounded-lg space-y-3">
                <h3 className="text-sm font-semibold text-amber-400">📋 Claim Link</h3>
                <p className="text-xs text-gray-400">
                  Share this link with your recipient alongside the audio file.
                  Anyone with this link can decrypt the message.
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-carnation bg-black/30 px-2 py-1 rounded font-mono break-all flex-1 max-h-20 overflow-auto">
                    {claimLink}
                  </code>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(claimLink)
                      setClaimCopied(true)
                      setTimeout(() => setClaimCopied(false), 2000)
                    }}
                    className="btn btn-xs btn-ghost text-gray-400"
                  >
                    {claimCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Decode View */}
        {tab === 'decode' && (
          <div className="space-y-4">
            {/* Decode method toggle */}
            <div className="tabs tabs-boxed bg-surface-secondary">
              <button
                className={`tab flex-1 ${decMethod === 'upload' ? 'tab-active !bg-gray-700 !text-white' : ''}`}
                onClick={() => setDecMethod('upload')}
              >
                Upload File
              </button>
              <button
                className={`tab flex-1 ${decMethod === 'listen' ? 'tab-active !bg-gray-700 !text-white' : ''}`}
                onClick={() => setDecMethod('listen')}
              >
                Listen Live
              </button>
            </div>

            {/* Shared: encryption mode + passphrase/wallet */}
            <EncryptionModeToggle mode={decMode} onChange={setDecMode} />

            {decMode === 'password' ? (
              <PasswordInput
                value={decPass}
                onChange={setDecPass}
                label="Passphrase (used during encoding)"
              />
            ) : (
              <div className="space-y-3">
                {!isConnected ? (
                  <div className="p-3 bg-surface-card border border-gray-600 rounded-lg text-center">
                    <p className="text-sm text-gray-400 mb-2">Connect the wallet the message was sent to</p>
                    <ConnectButton />
                  </div>
                ) : (
                  <div className="p-3 bg-surface-card border border-gray-600 rounded-lg space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-green-400">Connected:</span>
                      <code className="text-sm text-gray-300">
                        {address?.slice(0, 6)}...{address?.slice(-4)}
                      </code>
                    </div>

                    {walletPubKey ? (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-400">Your Carnation Radio ID (share with senders):</p>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-carnation bg-black/30 px-2 py-1 rounded font-mono break-all flex-1">
                            {walletPubKey}
                          </code>
                          <button
                            onClick={handleCopyId}
                            className="btn btn-xs btn-ghost text-gray-400"
                          >
                            {copied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={handleGetId}
                        className="btn btn-sm btn-outline btn-info w-full"
                      >
                        Get My Carnation Radio ID
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Claim link input */}
            {decMode === 'password' && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-gray-300">Have a claim link?</span>
                </label>
                <input
                  type="text"
                  value={claimKeyInput}
                  onChange={(e) => {
                    setClaimKeyInput(e.target.value.trim())
                    const parsed = parseClaimLink(e.target.value.trim())
                    if (parsed) {
                      setPendingClaimKey(parsed.key)
                    } else {
                      setPendingClaimKey(null)
                    }
                  }}
                  placeholder="Paste claim link here (optional)"
                  className="input input-bordered w-full bg-surface-card border-gray-600 text-white placeholder-gray-500 text-sm"
                />
                {pendingClaimKey && (
                  <label className="label">
                    <span className="label-text-alt text-success">✓ Valid claim link — upload the audio to decrypt</span>
                  </label>
                )}
              </div>
            )}

            {pendingClaimKey && (
              <div className="p-3 bg-surface-card border border-green-600/50 rounded-lg">
                <p className="text-sm text-green-400">🔑 You have a pending message. Upload the audio file to decrypt.</p>
              </div>
            )}

            {/* Upload mode */}
            {decMethod === 'upload' && (
              <>
                <AudioDropzone onFile={(f) => {
                  setDecFile(f)
                  setDecAudioUrl(URL.createObjectURL(f))
                  setDecState('idle')
                  setDecMessage('')
                  setDecError(null)
                }} file={decFile} testId="audio-upload-decode" />

                <button
                  onClick={handleDecode}
                  disabled={decodeDisabled}
                  className="btn btn-primary w-full"
                  data-testid="btn-decode"
                >
                  {decMode === 'wallet' && !isConnected ? 'Connect Wallet to Decode' : 'Decode Message'}
                </button>

                {decAudioUrl && (
                  <AudioPlayer src={decAudioUrl} />
                )}
              </>
            )}

            {/* Listen mode */}
            {decMethod === 'listen' && (
              <>
                {!liveDecoding && decState !== 'revealed' && (
                  <button
                    onClick={() => {
                      setDecState('idle')
                      setDecMessage('')
                      setDecError(null)
                      setLiveDecoding(true)
                      setLiveProgress(0)
                    }}
                    disabled={decMode === 'password' ? !decPass : !isConnected}
                    className="btn btn-secondary w-full"
                  >
                    Start Listening
                  </button>
                )}

                {liveDecoding && !decFile && (
                  <div className="space-y-4">
                    {/* Listening visual */}
                    <div className="flex flex-col items-center py-6 space-y-3">
                      <div className="flex items-center gap-1">
                        <span className="w-1 h-4 bg-carnation rounded-full animate-pulse" />
                        <span className="w-1 h-6 bg-carnation rounded-full animate-pulse [animation-delay:150ms]" />
                        <span className="w-1 h-8 bg-carnation rounded-full animate-pulse [animation-delay:300ms]" />
                        <span className="w-1 h-6 bg-carnation rounded-full animate-pulse [animation-delay:450ms]" />
                        <span className="w-1 h-4 bg-carnation rounded-full animate-pulse [animation-delay:600ms]" />
                      </div>
                      <p className="text-sm text-gray-400">Waiting for audio... Upload or play a file below</p>
                    </div>

                    <AudioDropzone onFile={(f) => {
                      setDecFile(f)
                      setDecAudioUrl(URL.createObjectURL(f))
                    }} file={decFile} testId="audio-upload-decode-live" />
                  </div>
                )}

                {liveDecoding && decFile && decAudioUrl && (
                  <div className="space-y-4">
                    {/* Active listening visual */}
                    <div className="flex flex-col items-center py-4 space-y-3">
                      <div className="flex items-center gap-1">
                        <span className="w-1 h-3 bg-carnation rounded-full animate-pulse" />
                        <span className="w-1 h-5 bg-carnation rounded-full animate-pulse [animation-delay:100ms]" />
                        <span className="w-1 h-7 bg-carnation rounded-full animate-pulse [animation-delay:200ms]" />
                        <span className="w-1 h-9 bg-carnation rounded-full animate-pulse [animation-delay:300ms]" />
                        <span className="w-1 h-7 bg-carnation rounded-full animate-pulse [animation-delay:400ms]" />
                        <span className="w-1 h-5 bg-carnation rounded-full animate-pulse [animation-delay:500ms]" />
                        <span className="w-1 h-3 bg-carnation rounded-full animate-pulse [animation-delay:600ms]" />
                      </div>
                      <p className="text-sm text-gray-400">
                        {liveProgress > 0
                          ? `Decoding... ${Math.round(liveProgress * 100)}%`
                          : 'Press play to start decoding'}
                      </p>
                      <div className="w-full">
                        <progress
                          className="progress progress-secondary w-full"
                          value={liveProgress}
                          max={1}
                        />
                      </div>
                    </div>

                    <AudioPlayer src={decAudioUrl} ref={audioRef} onPlay={handleLiveDecode} />
                  </div>
                )}

                {decState === 'revealed' && !liveDecoding && (
                  <button
                    onClick={() => {
                      setDecState('idle')
                      setDecMessage('')
                      setDecError(null)
                      setDecFile(null)
                      setDecAudioUrl(null)
                      setLiveProgress(0)
                      if (audioCtxRef.current) {
                        audioCtxRef.current.close().catch(() => {})
                        audioCtxRef.current = null
                      }
                    }}
                    className="btn btn-outline btn-secondary w-full"
                  >
                    Listen Again
                  </button>
                )}
              </>
            )}

            {decError && (
              <div className="alert alert-error">
                <span>{decError}</span>
              </div>
            )}

            <MessageReveal state={decState} message={decMessage} />

            {/* Registration prompt — shown after successful decode */}
            {decState === 'revealed' && registrationStatus === 'prompting' && (
              <div className="p-4 bg-surface-card border border-gray-600 rounded-lg space-y-3" data-testid="registration-prompt">
                <h3 className="text-sm font-semibold text-gray-200">📡 Register for direct messages</h3>
                <p className="text-sm text-gray-400">
                  Register your address for direct future messages (no claim link needed).
                </p>
                <p className="text-xs text-gray-500">
                  This sends one transaction and permanently links your address to Carnation.
                </p>

                {/* If wallet not connected or no pubkey, prompt to connect/sign first */}
                {(!isConnected || !walletPubKey) ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-400">
                      {!isConnected
                        ? 'Connect your wallet to register.'
                        : 'Sign to derive your Carnation ID first.'}
                    </p>
                    {!isConnected ? (
                      <ConnectButton />
                    ) : (
                      <button
                        onClick={handleGetId}
                        className="btn btn-sm btn-outline btn-info w-full"
                      >
                        Get My Carnation ID
                      </button>
                    )}
                    <button
                      onClick={() => setRegistrationStatus('skipped')}
                      className="btn btn-sm btn-ghost text-gray-500 w-full"
                    >
                      Skip, keep no trace
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleRegister}
                      className="btn btn-sm btn-primary flex-1"
                      data-testid="btn-register"
                    >
                      Register on Base — ~$0.01 gas
                    </button>
                    <button
                      onClick={() => setRegistrationStatus('skipped')}
                      className="btn btn-sm btn-ghost text-gray-500 flex-1"
                      data-testid="btn-skip-register"
                    >
                      Skip, keep no trace
                    </button>
                  </div>
                )}

                {registrationError && (
                  <p className="text-xs text-error">{registrationError}</p>
                )}
              </div>
            )}

            {decState === 'revealed' && registrationStatus === 'registering' && (
              <div className="p-4 bg-surface-card border border-gray-600 rounded-lg flex items-center gap-3" data-testid="registration-registering">
                <span className="loading loading-spinner loading-sm text-carnation" />
                <p className="text-sm text-gray-400">Sending registration transaction…</p>
              </div>
            )}

            {decState === 'revealed' && registrationStatus === 'done' && (
              <div className="p-4 bg-surface-card border border-green-600/50 rounded-lg" data-testid="registration-done">
                <p className="text-sm text-green-400">✓ Registered! Senders can now find you directly on-chain.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
