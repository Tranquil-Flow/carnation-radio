const FRAME_SIZE = 1024;

class DecodeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.decoder = null;
    this.buffer = new Float64Array(FRAME_SIZE);
    this.bufferOffset = 0;
    this.done = false;

    this.port.onmessage = async (event) => {
      if (event.data.type === 'init') {
        const { key, totalFrames, wasmUrl } = event.data;
        const wasm = await import(wasmUrl);
        await wasm.default();
        this.decoder = new wasm.FrameDecoder(new Uint8Array(key), totalFrames);
        this.port.postMessage({ type: 'ready' });
      }
    };
  }

  process(inputs) {
    if (this.done || !this.decoder || !inputs[0]?.[0]) return true;

    const input = inputs[0][0];
    for (let i = 0; i < input.length; i++) {
      // CRITICAL: Scale from Web Audio [-1,1] to PCM [-32768,32767]
      this.buffer[this.bufferOffset++] = input[i] * 32768.0;
      if (this.bufferOffset >= FRAME_SIZE) {
        const result = this.decoder.feed_frame(this.buffer);
        if (result) {
          this.port.postMessage({ type: 'decoded', payload: Array.from(result) });
          this.done = true;
          return true;
        }
        this.port.postMessage({ type: 'progress', value: this.decoder.progress() });
        this.bufferOffset = 0;
      }
    }
    return true;
  }
}

registerProcessor('decode-processor', DecodeProcessor);
