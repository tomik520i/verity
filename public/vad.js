// Silero VAD v5 / ONNX Runtime: inference and initialization run in a module worker.
// Assets are served locally. No microphone samples leave the device for VAD.
let worker = null, ready = null, nextId = 1, nextStream = 1;
const waiting = new Map();

function fail(target, error) {
  if (worker !== target) return;
  worker = null; ready = null;
  target.terminate();
  for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.reject(error); }
  waiting.clear();
}

function call(type, samples, stream) {
  const target = worker;
  if (!target) return Promise.reject(Error('Silero worker neběží'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => fail(target, Error('Silero neodpovídá včas')), type === 'init' ? 25000 : 2000);
    waiting.set(id, { resolve, reject, timer });
    try { target.postMessage({ id, type, samples, stream }, samples ? [samples.buffer] : []); }
    catch (error) { fail(target, error); }
  });
}

export function preload() {
  if (ready) return ready;
  // Start on the next microtask so even a synchronous Worker constructor failure clears ready.
  let target;
  const attempt = Promise.resolve().then(async () => {
    target = worker = new Worker(new URL('./vad-worker.js?v=20261107-2', import.meta.url), { type: 'module' });
    target.onmessage = ({ data }) => {
      if (worker !== target) return;
      const entry = waiting.get(data.id); if (!entry) return;
      waiting.delete(data.id); clearTimeout(entry.timer);
      data.error ? entry.reject(Error(data.error)) : entry.resolve(data.probs);
    };
    target.onerror = event => { event.preventDefault?.(); fail(target, Error(event.message || 'Silero worker spadl')); };
    target.onmessageerror = () => fail(target, Error('Nečitelná odpověď Silero'));
    await call('init');
  }).catch(error => { if (worker === target && target) fail(target, error); if (ready === attempt) ready = null; throw error; });
  ready = attempt;
  return attempt;
}

export class SileroVad {
  constructor() { this.stream = nextStream++; }
  static async create() { await preload(); const vad = new SileroVad(); await vad.reset(); return vad; }
  reset() { return call('reset', undefined, this.stream); }
  process(samples) { return call('process', samples.slice(), this.stream); }
}
