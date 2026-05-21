let wasmModule: any = null

async function loadWasm() {
  if (wasmModule) return wasmModule
  const mod = await import('../../carnation-stego/pkg/carnation_stego')
  await mod.default()
  wasmModule = mod
  return mod
}

export async function stegoEncode(
  samples: Float64Array, message: Uint8Array, key: Uint8Array,
): Promise<Float64Array> {
  const wasm = await loadWasm()
  return wasm.wasm_encode(samples, message, key)
}

export async function stegoDecode(
  samples: Float64Array, key: Uint8Array,
): Promise<Uint8Array> {
  const wasm = await loadWasm()
  return wasm.wasm_decode(samples, key)
}

export async function createFrameDecoder(key: Uint8Array, totalFrames: number) {
  const wasm = await loadWasm()
  return new wasm.FrameDecoder(key, totalFrames)
}
