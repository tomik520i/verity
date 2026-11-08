import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { wav, startMicrophone } from '../public/live-audio.js';
const pcm = await fs.readFile(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8');
function resample(rate, source, block = 128) {
  let Processor; const packets = [];
  class Base { constructor() { this.port = { postMessage: p => packets.push(p) }; } }
  vm.runInNewContext(pcm, { AudioWorkletProcessor: Base, sampleRate: rate, Float32Array, Math,
    registerProcessor: (name, cls) => Processor = cls });
  const p = new Processor({ processorOptions: { outRate: 16000 } });
  for (let at = 0; at < source.length; at += block) p.process([[source.subarray(at, at + block)]]);
  p.port.onmessage({ data: 'flush' });
  assert.equal(p.process([[new Float32Array(128)]]), false);
  assert.equal(packets.at(-1).flushed, true);
  const parts = packets.filter(p => p instanceof Float32Array);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
const tone = (rate, freq, duration = 2) => Float32Array.from({ length: Math.round(rate * duration) }, (_, i) => .5 * Math.sin(2 * Math.PI * freq * i / rate));
const rms = a => Math.sqrt(a.reduce((s, x) => s + x*x, 0) / a.length);
for (const rate of [16000, 32000, 44100, 48000, 96000]) {
  const input = tone(rate, 1000), out = resample(rate, input);
  assert.ok(Math.abs(out.length - 32000) <= 1, String(rate) + ' sample count');
  const gain = 20 * Math.log10(rms(out.slice(100)) / (.5 / Math.SQRT2));
  assert.ok(Math.abs(gain) < .15, String(rate) + ' tone gain ' + gain);
  assert.deepEqual(out, resample(rate, input, 777), 'chunk boundaries change PCM');
  console.log('PASS resampling', rate, '→ 16000:', out.length, 'samples, gain', gain.toFixed(3), 'dB');
}
for (const rate of [44100, 48000]) {
  const db = 20 * Math.log10(rms(resample(rate, tone(rate, 11000)).slice(100)) / (.5 / Math.SQRT2));
  assert.ok(db < -45, 'anti-alias filter'); console.log('PASS anti-alias', rate, db.toFixed(1), 'dB');
}
await fs.writeFile(new URL('resample-48k-to16k.wav', import.meta.url), Buffer.from(await wav(resample(48000,tone(48000,1000)),16000).arrayBuffer()));
let capture, stopped = false, closed = false, requests = [];
class FakeContext {
  sampleRate = 48000;
  audioWorklet = { addModule: async () => {} };
  constructor(options) { assert.equal(options, undefined, 'must not force device sample rate'); closed = false; }
  async resume() {} createMediaStreamSource() { return { connect(){}, disconnect(){} }; }
  createGain() { return { gain: { value: 1 }, connect(){}, disconnect(){} }; }
  async close() { closed = true; }
}
class Capture {
  constructor() { capture = this; this.port = { postMessage: () => queueMicrotask(() => {
    this.port.onmessage?.({ data: new Float32Array(77) });
    this.port.onmessage?.({ data: { flushed: true } });
  }) }; }
  connect() {} disconnect() {}
}
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async constraints => {
  assert.equal(constraints.audio.sampleRate, undefined);
  for (const key of ['echoCancellation','noiseSuppression','autoGainControl']) assert.equal(constraints.audio[key], false);
  stopped = false;
  return { getTracks: () => [{ stop() { stopped = true; } }] };
} } }, configurable: true });
globalThis.AudioContext = FakeContext; globalThis.AudioWorkletNode = Capture;
globalThis.fetch = async (url, opts) => {
  const bytes = await opts.body.arrayBuffer(); requests.push({ url, length: (bytes.byteLength - 44) / 2 });
  return { ok: true, json: async () => ({ text: 'Dokončená věta.', debug_saved: true }) };
};
for (let cycle = 0; cycle < 3; cycle++) {
  requests = [];
  const m = await startMicrophone({ vad: false });
  let calls = 0;
  m.engine.vad = { async process() { if (calls++ === 0) await new Promise(r => setTimeout(r, 700)); return [.9]; } };
  for (let i = 0; i < 4; i++) capture.port.onmessage({ data: new Float32Array(2048).fill(.1) });
  const pending = m.stop();
  assert.equal(stopped, true, 'device must release immediately');
  assert.equal(m.stop(), pending, 'stop must be idempotent');
  assert.equal(await pending, 'Dokončená věta.');
  assert.equal(closed, true);
  assert.equal(Math.round(m.engine.elapsed * 16000), 8269, 'slow VAD lost final samples');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].length, 8269);
  console.log('PASS slow VAD flush/restart cycle', cycle + 1);
}
const m = await startMicrophone({ vad:false });
capture.port.onmessage({ data:new Float32Array(2048).fill(.2) });
assert.equal(await m.cancel(), ''); assert.equal(m.engine.cancelled, true); assert.ok(stopped && closed);
console.log('PASS cancel releases device and context');

const sharedContext=new FakeContext();requests=[];
const sharedMic=await startMicrophone({vad:false,debug:true,audioContext:sharedContext});
sharedMic.engine.vad={async process(){return [.9];}};
capture.port.onmessage({data:{raw:new Float32Array(4800).fill(.1)}});
for(let i=0;i<4;i++)capture.port.onmessage({data:new Float32Array(2048).fill(.1)});
assert.equal(await sharedMic.stop(),'Dokončená věta.');
assert.equal(closed,false,'must not close the shared playback context');
assert.equal(stopped,true);
assert.equal(requests.filter(r=>r.url.includes('source=1')).length,1);
assert.equal(requests.find(r=>r.url.includes('source=1')).length,4800);
console.log('PASS unprocessed capture constraints, shared context retained, one native diagnostic archive');
let NativeProcessor;const nativePackets=[];
class NativeBase{constructor(){this.port={postMessage:p=>nativePackets.push(p)};}}
vm.runInNewContext(pcm,{AudioWorkletProcessor:NativeBase,sampleRate:48000,Float32Array,Math,registerProcessor:(name,cls)=>NativeProcessor=cls});
const nativeProcessor=new NativeProcessor({processorOptions:{outRate:16000,diagnostic:true}});
const nativeInput=tone(48000,1000,.25);
for(let at=0;at<nativeInput.length;at+=128)nativeProcessor.process([[nativeInput.subarray(at,at+128)]]);
nativeProcessor.port.onmessage({data:'flush'});
const rawParts=nativePackets.filter(p=>p.raw).map(p=>p.raw);
const exactRaw=new Float32Array(rawParts.reduce((n,p)=>n+p.length,0));let rawAt=0;for(const p of rawParts){exactRaw.set(p,rawAt);rawAt+=p.length;}
assert.deepEqual(exactRaw,nativeInput,'native reference must be untouched');
assert.equal(nativePackets.filter(p=>p instanceof Float32Array).reduce((n,p)=>n+p.length,0),4000);
console.log('PASS native diagnostic branch is sample-exact before resampling');
