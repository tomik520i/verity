// Audio vlákno: sbírá mono Float32 vzorky po blocích 2048 a posílá je hlavnímu vláknu.
// Zpráva 'flush' odešle zbytek bufferu a potvrdí {flushed: true}.
//
// AudioContext běží v nativní frekvenci zařízení (telefony 48 kHz) – vynucených 16 kHz
// na Androidu praskalo (výpadky po 10 ms). Na processorOptions.outRate se převádí tady:
// dolní propust (windowed-sinc FIR, 63 koeficientů, 7,2 kHz) proti aliasingu a pak
// lineární interpolace mezi vyfiltrovanými vzorky.
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.rawBuffer = options?.processorOptions?.diagnostic ? new Float32Array(8192) : null;
    this.rawOffset = 0; this.rawRemaining = sampleRate * 30;
    const outRate = options?.processorOptions?.outRate || sampleRate;
    this.step = sampleRate / outRate;
    if (this.step > 1) {
      const taps = 63, fc = Math.min(7200, outRate * 0.45) / sampleRate;
      this.fir = new Float32Array(taps);
      let sum = 0;
      for (let i = 0; i < taps; i++) {
        const n = i - (taps - 1) / 2;
        const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
        this.fir[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1)));   // Hamming
        sum += this.fir[i];
      }
      for (let i = 0; i < taps; i++) this.fir[i] /= sum;
      this.hist = new Float32Array(taps); this.hpos = 0;
      this.prevY = 0; this.n = 0; this.t = 0;    // n = index vstupního vzorku, t = čas dalšího výstupu
    }
    this.port.onmessage = e => {
      if (e.data !== 'flush') return;
      this.stopped = true;
      if (this.rawOffset) this.port.postMessage({ raw: this.rawBuffer.slice(0, this.rawOffset) });
      this.rawOffset = 0;
      if (this.offset) { this.port.postMessage(this.buffer.slice(0, this.offset)); this.offset = 0; }
      this.port.postMessage({ flushed: true });
    };
  }
  push(x) {
    this.buffer[this.offset++] = x;
    if (this.offset === this.buffer.length) {
      this.port.postMessage(this.buffer, [this.buffer.buffer]);
      this.buffer = new Float32Array(2048);
      this.offset = 0;
    }
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    // Opt-in diagnostic copy before FIR, resampling, normalization and VAD. At most 30 seconds.
    if (this.rawBuffer && this.rawRemaining > 0) {
      let at = 0;
      while (at < input.length && this.rawRemaining > 0) {
        const count = Math.min(input.length - at, this.rawBuffer.length - this.rawOffset, this.rawRemaining);
        this.rawBuffer.set(input.subarray(at, at + count), this.rawOffset);
        this.rawOffset += count; this.rawRemaining -= count; at += count;
        if (this.rawOffset === this.rawBuffer.length) {
          this.port.postMessage({ raw: this.rawBuffer }, [this.rawBuffer.buffer]);
          this.rawBuffer = new Float32Array(8192); this.rawOffset = 0;
        }
      }
    }
    if (!this.fir) { for (let i = 0; i < input.length; i++) this.push(input[i]); return true; }
    const { fir, hist } = this, taps = fir.length;
    for (let i = 0; i < input.length; i++) {
      hist[this.hpos] = input[i];
      let y = 0, h = this.hpos;
      for (let k = 0; k < taps; k++) { y += fir[k] * hist[h]; h = h === 0 ? taps - 1 : h - 1; }
      this.hpos = this.hpos === taps - 1 ? 0 : this.hpos + 1;
      // výstupy, které padnou mezi předchozí (n−1) a tento (n) vstupní vzorek
      while (this.t <= this.n) {
        this.push(this.prevY + (y - this.prevY) * (this.t - (this.n - 1)));
        this.t += this.step;
      }
      this.prevY = y; this.n++;
    }
    if (this.n > 1e6) { this.n -= 1e6; this.t -= 1e6; }   // ať čísla nerostou a neztrácí přesnost
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
