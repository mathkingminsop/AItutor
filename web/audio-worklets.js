// AudioWorklet 두 개: 마이크 캡처(→ 16kHz PCM16)와 음성 재생(24kHz PCM16 → 스피커).

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 640; // 16kHz 기준 40ms

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // sampleRate: 워클릿 전역 (예: 48000)
    this.pos = 0; // 입력 기준 다음 샘플 위치(소수)
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outLen = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    // 선형 보간으로 16kHz로 다운샘플
    while (this.pos < input.length - 1) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const s = input[i] * (1 - frac) + input[i + 1] * frac;
      this.sumSq += s * s;
      const clamped = Math.max(-1, Math.min(1, s));
      this.out[this.outLen++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.outLen === CHUNK_SAMPLES) {
        const rms = Math.sqrt(this.sumSq / CHUNK_SAMPLES);
        this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]);
        this.out = new Int16Array(CHUNK_SAMPLES);
        this.outLen = 0;
        this.sumSq = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    return true;
  }
}

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.wasPlaying = false;
    this.port.onmessage = (e) => {
      if (e.data.type === 'push') this.queue.push(e.data.samples);
      else if (e.data.type === 'clear') {
        this.queue = [];
        this.current = null;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length) {
      if (!this.current) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
        if (!this.current) break;
      }
      const n = Math.min(out.length - i, this.current.length - this.offset);
      out.set(this.current.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      if (this.offset >= this.current.length) this.current = null;
    }
    out.fill(0, i);
    const playing = i > 0;
    if (playing !== this.wasPlaying) {
      this.port.postMessage({ type: playing ? 'playing' : 'idle' });
      this.wasPlaying = playing;
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
registerProcessor('playback-processor', PlaybackProcessor);
