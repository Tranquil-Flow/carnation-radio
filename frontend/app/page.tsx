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
import { stegoEncode, stegoDecode, createFrameDecoder } from '@/lib/stego'
import { ofdmEncodePayload, mixOfdmCarrier } from '@/lib/acoustic-ofdm'
import { AcousticListener } from '@/lib/microphone-listener'
import { toWav, toWavBlob } from '@/lib/transcode'
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
type DecodeMethod = 'upload' | 'listen' | 'mic'

function deriveEmbedKey(secret: string): Uint8Array {
  return sha256(new TextEncoder().encode('carnation-embed:' + secret))
}

/** Translate raw acoustic-decoder error strings into a short user-facing hint shown
 * under the live mic status. Falls through to the raw text for unknown errors. */
function humanizeDecodeError(raw: string | null): string {
  if (!raw) return ''
  if (/preamble not found/i.test(raw)) return 'Looking for a Carnation signal…'
  if (/header incomplete|packet incomplete/i.test(raw)) return 'Catching the start of a packet…'
  if (/magic mismatch/i.test(raw)) return 'Signal detected — trying to lock on'
  if (/checksum mismatch/i.test(raw)) return 'Signal too noisy — try moving closer or quieter background'
  return raw
}

/** Build the user-facing error shown when mic listening times out without a successful
 * decode. The advice changes based on how far the decoder got before timeout. */
function decodeFailureAdvice(lastErr: string | null, hadPreamble: boolean): string {
  if (hadPreamble && lastErr && /checksum mismatch/i.test(lastErr)) {
    return "Couldn't recover the message — signal arrived but was too distorted. Try moving closer to the speakers, reducing background noise, or playing at higher volume."
  }
  if (hadPreamble) {
    return "Detected a Carnation signal but couldn't lock onto the full packet. Try moving closer or making sure the song plays from the beginning."
  }
  return "No Carnation signal detected. Make sure: 1) the encoded song is playing through speakers near this device, 2) volume is reasonably loud, 3) the room isn't too noisy."
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
  const [encAcousticCarrier, setEncAcousticCarrier] = useState(false)

  // Recipient registry status
  const [recipientStatus, setRecipientStatus] = useState<'idle' | 'checking' | 'registered' | 'unregistered'>('idle')

  // Claim link decode state (Mode B recipient)
  const [claimKeyInput, setClaimKeyInput] = useState('')
  const [pendingClaimKey, setPendingClaimKey] = useState<Uint8Array | null>(null)

  // Decode state
  const [decMethod, setDecMethod] = useState<DecodeMethod>('upload')
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
  const micStreamRef = useRef<MediaStream | null>(null)
  const [liveDecoding, setLiveDecoding] = useState(false)
  const [liveProgress, setLiveProgress] = useState(0)
  const [liveReady, setLiveReady] = useState(false)
  // Mic-only fields: elapsed wall-clock seconds + best-known acoustic status.
  const [micElapsedSec, setMicElapsedSec] = useState(0)
  const [micStatus, setMicStatus] = useState<'preparing' | 'listening' | 'preamble-detected' | 'failed'>('preparing')
  const [micStatusDetail, setMicStatusDetail] = useState<string | null>(null)

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
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop())
        micStreamRef.current = null
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

      // Rust engine adds version byte + framing internally via build_payload() for the legacy
      // stego path. The acoustic proof carrier has its own packet framing, so provide the
      // same versioned payload that stegoDecode() returns after Rust framing extraction.
      const acousticPayload = encrypted[0] >= 0x01 && encrypted[0] <= 0x12
        ? encrypted
        : (() => {
          const payload = new Uint8Array(1 + encrypted.length)
          payload[0] = 0x01
          payload.set(encrypted, 1)
          return payload
        })()

      setEncStage('embedding')
      const encoded = encAcousticCarrier
        ? mixOfdmCarrier(new Float64Array(samples), ofdmEncodePayload(acousticPayload))
        : await stegoEncode(
          new Float64Array(samples),
          encrypted,
          embedKey,
        )

      setEncStage('compressing')
      const wavBlob = await toWavBlob(new Float64Array(encoded))

      setEncStage('done')
      setDownloadUrl(URL.createObjectURL(wavBlob))
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
    // If the graph is already connected, a later play event can still resume a suspended context.
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      return
    }

    setDecError(null)
    setLiveReady(false)
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

      // AudioWorklets cannot dynamically import wasm-pack ESM glue. Keep WASM decoding
      // on the main thread and use the worklet only to stream PCM frames from playback.
      const frameDecoder = await createFrameDecoder(embedKey, totalFrames)
      const collectedFrames: Float64Array[] = []
      let decoded = false

      const revealPayload = async (rawPayload: Uint8Array) => {
        const { data } = detectVersion(rawPayload)
        let plaintext: Uint8Array
        if (decMode === 'wallet' && walletPrivHex) {
          plaintext = await walletDecrypt(walletPrivHex, data)
        } else {
          plaintext = await decryptMessage(data, decPass)
        }
        setDecMessage(new TextDecoder().decode(plaintext))
        setDecState('revealed')
        setLiveDecoding(false)
      }

      const decodeBrowserAudioBuffer = async () => {
        if (!decAudioUrl) throw new Error('No audio source available')
        const response = await fetch(decAudioUrl)
        const arrayBuffer = await response.arrayBuffer()
        const decodeCtx = new AudioContext({ sampleRate: 44100 })
        try {
          const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer)
          const channel = audioBuffer.getChannelData(0)
          const samples = new Float64Array(channel.length)
          for (let i = 0; i < channel.length; i++) {
            samples[i] = channel[i] * 32768.0
          }
          return stegoDecode(samples, embedKey)
        } finally {
          decodeCtx.close().catch(() => {})
        }
      }

      const decodeCollectedPlayback = async () => {
        if (decoded || collectedFrames.length === 0) return
        let lastError: any = null
        try {
          const totalSamples = collectedFrames.reduce((sum, frame) => sum + frame.length, 0)
          const playbackSamples = new Float64Array(totalSamples)
          let offset = 0
          for (const frame of collectedFrames) {
            playbackSamples.set(frame, offset)
            offset += frame.length
          }

          // MediaElement playback can prepend a few silent render quanta before media starts.
          // Try bounded likely alignments before falling back to browser-native decodeAudioData.
          let firstSignal = 0
          while (firstSignal < playbackSamples.length && Math.abs(playbackSamples[firstSignal]) < 1) {
            firstSignal++
          }
          const commonMp3Delays = [0, 529, 576, 1024, 1056, 1105, 1152, 1728, 2048]
          const coarseFrameOffsets = Array.from({ length: 17 }, (_, i) => i * 64)
          const candidateOffsets = Array.from(new Set([
            ...commonMp3Delays,
            ...coarseFrameOffsets,
            firstSignal,
            firstSignal % 1024,
            ...commonMp3Delays.map(delay => firstSignal + delay),
            ...commonMp3Delays.map(delay => Math.max(0, firstSignal - delay)),
          ])).filter(offset => offset >= 0 && offset < playbackSamples.length)
          for (const candidateOffset of candidateOffsets) {
            if (candidateOffset >= playbackSamples.length) continue
            try {
              const rawPayload = await stegoDecode(playbackSamples.subarray(candidateOffset), embedKey)
              await revealPayload(rawPayload)
              decoded = true
              return
            } catch (err) {
              lastError = err
            }
          }
          try {
            const rawPayload = await decodeBrowserAudioBuffer()
            await revealPayload(rawPayload)
            decoded = true
            return
          } catch (err) {
            lastError = err
          }

          throw lastError || new Error('Live decode failed')
        } catch (err: any) {
          const raw = err?.message || 'Decryption failed'
          const { message } = formatEncodeError(raw)
          setDecError(message)
          setDecState('idle')
          setLiveDecoding(false)
        }
      }

      await ctx.audioWorklet.addModule('/worklet/decode-processor.js')
      const workletNode = new AudioWorkletNode(ctx, 'decode-processor')

      workletNode.onprocessorerror = () => {
        setDecError('Live decoder crashed')
        setDecState('idle')
        setLiveDecoding(false)
      }

      workletNode.port.onmessage = async (event: MessageEvent) => {
        if (event.data.type === 'ready') {
          setLiveReady(true)
          return
        }

        if (event.data.type === 'error') {
          setDecError(event.data.message || 'Live decode failed')
          setDecState('idle')
          setLiveDecoding(false)
          return
        }

        if (event.data.type !== 'frame' || decoded) return

        const samples = event.data.samples instanceof Float64Array
          ? event.data.samples
          : new Float64Array(event.data.samples)
        collectedFrames.push(samples)

        const rawPayload = frameDecoder.feed_frame(samples)
        setLiveProgress(Math.min(frameDecoder.progress(), 1))

        if (!rawPayload) return
        decoded = true

        try {
          await revealPayload(rawPayload)
        } catch (err: any) {
          const raw = err?.message || 'Decryption failed'
          const { message } = formatEncodeError(raw)
          setDecError(message)
          setDecState('idle')
          setLiveDecoding(false)
        }
      }

      const source = ctx.createMediaElementSource(audioRef.current)
      source.connect(workletNode)
      workletNode.connect(ctx.destination)

      audioRef.current.addEventListener('ended', () => {
        void decodeCollectedPlayback()
      }, { once: true })

      workletNode.port.postMessage({ type: 'init' })
      setLiveReady(true)

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
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

  async function handleMicrophoneDecode() {
    if (audioCtxRef.current) return

    setDecError(null)
    setDecMessage('')
    setLiveProgress(0)
    setLiveReady(false)
    setLiveDecoding(true)
    setMicElapsedSec(0)
    setMicStatus('preparing')
    setMicStatusDetail(null)
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

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is not available in this browser')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 44100,
        },
      })
      console.log('Microphone stream settings', stream.getAudioTracks()[0]?.getSettings?.())
      micStreamRef.current = stream

      // Cap total mic listening at 3 minutes — surfaces a UI failure after that.
      const maxCaptureSeconds = 180
      const totalFrames = Math.floor(maxCaptureSeconds * 44100 / 1024)
      const ctx = new AudioContext({ sampleRate: 44100 })
      console.log('Microphone AudioContext sampleRate', ctx.sampleRate)
      audioCtxRef.current = ctx
      const frameDecoder = await createFrameDecoder(embedKey, totalFrames)
      // Bounded rolling-window FSK listener. Window sized for 5x bit-repetition + RS(255,223)
      // packets: small messages → ~62s of audio, so 120s window safely covers one full packet
      // plus loop slack. First decode attempt ~3s after capture begins, then ~every 2s
      // (CPU-cheaper than every 1s with the larger search space + RS overhead).
      const acoustic = new AcousticListener({
        rollingWindowSeconds: 120,
        minFramesBeforeFirstDecode: 130,
        decodeIntervalFrames: 86,
      })
      let decoded = false

      const stopMic = () => {
        micStreamRef.current?.getTracks().forEach(track => track.stop())
        micStreamRef.current = null
        audioCtxRef.current?.close().catch(() => {})
        audioCtxRef.current = null
        setLiveDecoding(false)
      }

      const revealPayload = async (rawPayload: Uint8Array) => {
        const { data } = detectVersion(rawPayload)
        let plaintext: Uint8Array
        if (decMode === 'wallet' && walletPrivHex) {
          plaintext = await walletDecrypt(walletPrivHex, data)
        } else {
          plaintext = await decryptMessage(data, decPass)
        }
        setDecMessage(new TextDecoder().decode(plaintext))
        setDecState('revealed')
        stopMic()
      }

      await ctx.audioWorklet.addModule('/worklet/decode-processor.js')
      const workletNode = new AudioWorkletNode(ctx, 'decode-processor')
      const silentGain = ctx.createGain()
      silentGain.gain.value = 0

      workletNode.onprocessorerror = () => {
        setDecError('Microphone decoder crashed')
        setDecState('idle')
        stopMic()
      }

      workletNode.port.onmessage = async (event: MessageEvent) => {
        if (event.data.type === 'ready') {
          setLiveReady(true)
          setMicStatus('listening')
          return
        }
        if (event.data.type === 'error') {
          setDecError(event.data.message || 'Microphone decode failed')
          setDecState('idle')
          stopMic()
          return
        }
        if (event.data.type !== 'frame' || decoded) return

        const samples = event.data.samples instanceof Float64Array
          ? event.data.samples
          : new Float64Array(event.data.samples)
        const readyToDecode = acoustic.push(samples)
        setMicElapsedSec(acoustic.elapsedSeconds())

        // Run the patchwork frame decoder in parallel for music-stego carriers.
        const rawPayload = frameDecoder.feed_frame(samples)
        setLiveProgress(Math.min(frameDecoder.progress(), 1))

        if (rawPayload) {
          decoded = true
          try {
            await revealPayload(rawPayload)
          } catch (err: any) {
            const raw = err?.message || 'Decryption failed'
            const { message } = formatEncodeError(raw)
            setDecError(message)
            setDecState('idle')
            stopMic()
          }
          return
        }

        if (readyToDecode) {
          const status = await acoustic.tryDecode()
          if (decoded) return
          if (status.kind === 'decoded') {
            decoded = true
            try {
              await revealPayload(status.payload)
            } catch (err: any) {
              const raw = err?.message || 'Decryption failed'
              const { message } = formatEncodeError(raw)
              setDecError(message)
              setDecState('idle')
              stopMic()
            }
            return
          }
          if (status.kind === 'preamble-detected') {
            setMicStatus('preamble-detected')
            setMicStatusDetail(humanizeDecodeError(status.detail))
          }
          if (acoustic.elapsedSeconds() >= maxCaptureSeconds) {
            const lastErr = acoustic.getLastError()
            const advice = decodeFailureAdvice(lastErr, acoustic.hadPreamble())
            setMicStatus('failed')
            setDecError(advice)
            setDecState('idle')
            stopMic()
          }
        }
      }

      const source = ctx.createMediaStreamSource(stream)
      source.connect(workletNode)
      // Keep the graph alive without audible feedback.
      workletNode.connect(silentGain)
      silentGain.connect(ctx.destination)
      workletNode.port.postMessage({ type: 'init' })
      setLiveReady(true)
      setMicStatus('listening')

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.includes('User rejected') || err?.name === 'NotAllowedError') {
        setDecError('Microphone permission was denied')
      } else {
        console.error('Microphone decode error:', err)
        setDecError(err?.message || 'Microphone decode failed')
      }
      setDecState('idle')
      setLiveDecoding(false)
      setLiveReady(false)
      setMicStatus('failed')
      micStreamRef.current?.getTracks().forEach(track => track.stop())
      micStreamRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
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

            <label className="label cursor-pointer gap-3 justify-start rounded-lg border border-gray-700 bg-surface-card p-3">
              <input
                type="checkbox"
                checked={encAcousticCarrier}
                onChange={(e) => setEncAcousticCarrier(e.target.checked)}
                className="checkbox checkbox-secondary"
                data-testid="checkbox-acoustic-carrier"
              />
              <span>
                <span className="block text-sm text-gray-200">Ultrasonic carrier (audible-mic decode)</span>
                <span className="block text-xs text-gray-500">Mixes a near-inaudible FSK data signal (18.5/19.5 kHz) into your song so a real microphone can decode it through the air. Music sounds normal to most adults.</span>
              </span>
            </label>

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
                download="carnation-encoded.wav"
                className="btn btn-outline btn-success w-full"
                data-testid="download-link"
              >
                Download Encoded WAV
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
                data-testid="decode-method-upload"
              >
                Upload File
              </button>
              <button
                className={`tab flex-1 ${decMethod === 'listen' ? 'tab-active !bg-gray-700 !text-white' : ''}`}
                onClick={() => setDecMethod('listen')}
                data-testid="decode-method-listen"
              >
                Browser Playback
              </button>
              <button
                className={`tab flex-1 ${decMethod === 'mic' ? 'tab-active !bg-gray-700 !text-white' : ''}`}
                onClick={() => setDecMethod('mic')}
                data-testid="decode-method-mic"
              >
                Listen from Microphone
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
                      setLiveReady(false)
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
                      setLiveReady(false)
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
                        {!liveReady
                          ? 'Preparing decoder...'
                          : liveProgress > 0
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

                    <AudioPlayer src={decAudioUrl} ref={audioRef} onReady={handleLiveDecode} onPlay={handleLiveDecode} controlsEnabled={liveReady} />
                  </div>
                )}


            {decState === 'revealed' && decMessage && (
                  <button
                    onClick={() => {
                      setDecState('idle')
                      setDecMessage('')
                      setDecError(null)
                      setDecFile(null)
                      setDecAudioUrl(null)
                      setLiveProgress(0)
                      setLiveReady(false)
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

            {/* Microphone mode */}
            {decMethod === 'mic' && (
              <div className="space-y-4">
                {!liveDecoding && decState !== 'revealed' && (
                  <button
                    onClick={handleMicrophoneDecode}
                    disabled={decMode === 'password' ? !decPass : !isConnected}
                    className="btn btn-secondary w-full"
                    data-testid="btn-start-microphone"
                  >
                    Start Microphone Listening
                  </button>
                )}

                {liveDecoding && decState !== 'revealed' && (
                  <div className="flex flex-col items-center py-6 space-y-3" data-testid="mic-listening-panel">
                    <div className="flex items-center gap-1">
                      <span className="w-1 h-4 bg-carnation rounded-full animate-pulse" />
                      <span className="w-1 h-6 bg-carnation rounded-full animate-pulse [animation-delay:150ms]" />
                      <span className="w-1 h-8 bg-carnation rounded-full animate-pulse [animation-delay:300ms]" />
                      <span className="w-1 h-6 bg-carnation rounded-full animate-pulse [animation-delay:450ms]" />
                      <span className="w-1 h-4 bg-carnation rounded-full animate-pulse [animation-delay:600ms]" />
                    </div>
                    <p className="text-sm text-gray-400" data-testid="mic-status-text">
                      {!liveReady
                        ? 'Preparing microphone decoder…'
                        : micStatus === 'preamble-detected'
                          ? `Acoustic signal detected — refining (${Math.round(micElapsedSec)}s)`
                          : `Listening (${Math.round(micElapsedSec)}s)`}
                    </p>
                    <p className="text-xs text-gray-500 text-center">
                      Play the encoded audio through speakers near this device. This path uses only microphone PCM — no upload fallback.
                    </p>
                    {micStatusDetail && (
                      <p className="text-xs text-amber-400 text-center" data-testid="mic-status-detail">
                        {micStatusDetail}
                      </p>
                    )}
                    <div className="w-full">
                      <progress
                        className="progress progress-secondary w-full"
                        value={Math.min(micElapsedSec / 180, 1)}
                        max={1}
                      />
                    </div>
                    <button
                      onClick={() => {
                        micStreamRef.current?.getTracks().forEach(t => t.stop())
                        micStreamRef.current = null
                        audioCtxRef.current?.close().catch(() => {})
                        audioCtxRef.current = null
                        setLiveDecoding(false)
                        setDecState('idle')
                        setMicStatus('listening')
                      }}
                      className="btn btn-sm btn-ghost"
                      data-testid="btn-stop-microphone"
                    >
                      Stop listening
                    </button>
                  </div>
                )}
              </div>
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
                      Register on Ethereum — ~$2–5 gas
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
