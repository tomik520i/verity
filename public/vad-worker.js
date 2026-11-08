// Silero VAD ve vlastním vlákně (Web Worker) – výpočet ani načtení ~15 MB WASM neblokuje
// hlavní vlákno stránky (na telefonu to přidávalo praskání). Logiku oken viz vad.js.
// Zprávy: {id, type: 'init'|'reset'|'process', samples?} → {id, probs?} nebo {id, error}.
import * as ort from './vad/ort.wasm.min.mjs';

const BASE = new URL('./vad/', import.meta.url).href;
let session = null, state, context, rest, streamId = null;
const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);

async function init() {
  if (session) return;
  ort.env.wasm.wasmPaths = BASE;
  ort.env.wasm.numThreads = 1;    // víc vláken by chtělo cross-origin isolation; na 32 ms okna stačí jedno
  session = await ort.InferenceSession.create(BASE + 'silero_vad.onnx');
}

function reset() {
  state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  context = new Float32Array(64);
  rest = new Float32Array(0);
}

// Okna po 512 vzorcích (32 ms při 16 kHz), před každé posledních 64 vzorků předchozího okna –
// bez toho kontextu vrací model u řeči samé nuly. Neúplný zbytek počká na další blok.
async function process(samples) {
  const all = new Float32Array(rest.length + samples.length);
  all.set(rest); all.set(samples, rest.length);
  const probs = [];
  let at = 0;
  for (; at + 512 <= all.length; at += 512) {
    const input = new Float32Array(576);
    input.set(context); input.set(all.subarray(at, at + 512), 64);
    const out = await session.run({ input: new ort.Tensor('float32', input, [1, 576]), state, sr });
    state = out.stateN;
    probs.push(out.output.data[0]);
    context = all.slice(at + 448, at + 512);
  }
  rest = all.slice(at);
  return probs;
}

// zprávy zpracovat přísně po sobě (session.run je asynchronní)
let queue = Promise.resolve();
self.onmessage = e => {
  const { id, type, samples, stream } = e.data;
  queue = queue.then(async () => {
    try {
      if (type === 'init') { await init(); reset(); postMessage({ id }); }
      else if (type === 'reset') { streamId = stream; reset(); postMessage({ id }); }
      else if (type === 'process') {
        if (stream !== streamId) throw Error('Starý záznam mikrofonu');
        postMessage({ id, probs: await process(samples) });
      } else throw Error('Neznámý požadavek VAD');
    } catch (err) { postMessage({ id, error: String(err?.message || err) }); }
  });
};
