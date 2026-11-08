// Experimentální lokální živý rozhovor. Stejný mikrofon po celou dobu hovoru.
// Nepořizuje archiv nahrávek. Režim výstupu volí reproduktory s blokováním vstupu / AEC / sluchátka.
import { startMicrophone, joinTranscript } from './live-audio.js?v=20261108-6';

export function endPause(text) {
  const t = text.trim();
  // Jednoduchá česká heuristika, nikoli model sémantického konce promluvy.
  if (!t || /(?:(?:^|\s)(?:a|ale|nebo|protože|takže|že|když|jestli|aby|kdyby|tedy)|[,;:])\s*[.!?…]*$/iu.test(t)) return 2.0;
  return /[.!?…][“”"']?\s*$/.test(t) ? 1.05 : 1.4;
}

// Čisté řízení tahů je oddělené od mikrofonu i generování odpovědi.
export class DialogueTurns {
  constructor({ engine, onTurn, onInterrupt = () => {}, isAnswering = () => false }) {
    Object.assign(this, { engine, onTurn, onInterrupt, isAnswering });
    this.voicedRun = 0; this.interrupted = false; this.stopped = false;
  }
  level(v) {
    if (this.stopped) return;
    // Hystereze „speaking“ trvá i v tichu; pro přerušení počítáme skutečně znělé bloky.
    const speech = v.speaking && v.voiced && (!v.neural || v.prob >= 0.55);
    this.voicedRun = speech ? this.voicedRun + v.dt : 0;
    if (!this.interrupted && this.isAnswering() && this.voicedRun >= (v.neural ? 0.28 : 0.48)) {
      this.interrupted = true;
      this.onInterrupt();
    }
    if (v.speaking || v.speechSeconds < 0.3) return;
    const text = joinTranscript(this.engine.segments);
    if (v.elapsed - v.lastSpeechAt < endPause(text)) return;
    const turn = this.engine.takeTurn();
    if (!turn) return; // čekáme na finální Whisper; poslech mezitím pokračuje
    this.interrupted = false; this.voicedRun = 0;
    if (turn.text.trim()) this.onTurn(turn);
  }
  stop() { this.stopped = true; }
}

export async function startDialogue({ audioContext, vad = true, onText = () => {}, onState = () => {},
  onLevel = () => {}, onTurn, onInterrupt, isAnswering, onIdle = () => {},
  getThreshold = () => null, suppressInput = () => false, echoCancellation = false }) {
  let control, lastActivity = 0, stopping = false;
  const capture = await startMicrophone({
    audioContext, vad, debug: false, getThreshold, suppressInput, echoCancellation, snapshotMs: 1100, snapshotSeconds: 1.1,
    onText,
    onState,
    onEnded: () => { stopping = true; control?.stop(); onIdle('Mikrofon se odpojil. Spusť rozhovor znovu.'); },
    onLevel: v => {
      onLevel(v);
      if (v.speaking || isAnswering()) lastActivity = v.elapsed;
      control?.level(v);
      // Dvě minuty úplné nečinnosti: mikrofon se zavře; žádné skryté znovuzapnutí.
      if (!stopping && v.elapsed - lastActivity > 120) { stopping = true; control?.stop(); onIdle(); }
    },
  });
  control = new DialogueTurns({ engine: capture.engine, onTurn, onInterrupt, isAnswering });
  return {
    engine: capture.engine,
    async stop() { stopping = true; control.stop(); return capture.stop(); },
    async cancel() { stopping = true; control.stop(); return capture.cancel(); },
  };
}
