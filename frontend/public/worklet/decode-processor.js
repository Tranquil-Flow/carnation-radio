const FRAME_SIZE = 1024;

class DecodeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float64Array(FRAME_SIZE);
    this.bufferOffset = 0;
    this.ready = false;

    this.port.onmessage = (event) => {
      if (event.data.type === 'init') {
        this.ready = true;
        this.port.postMessage({ type: 'ready' });
      }
    };
  }

  process(inputs) {
    if (!this.ready || !inputs[0]?.[0]) return true;

    const input = inputs[0][0];
    for (let i = 0; i < input.length; i++) {
      // CRITICAL: Scale from Web Audio [-1,1] to PCM [-32768,32767]
      this.buffer[this.bufferOffset++] = input[i] * 32768.0;
      if (this.bufferOffset >= FRAME_SIZE) {
        const frame = this.buffer;
        this.port.postMessage({ type: 'frame', samples: frame }, [frame.buffer]);
        this.buffer = new Float64Array(FRAME_SIZE);
        this.bufferOffset = 0;
      }
    }
    return true;
  }
}

registerProcessor('decode-processor', DecodeProcessor);
