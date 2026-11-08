// Stav odvozený od skutečné práce, nikoli od pevného časovače "hotovo".
export function describeActivity(s) {
  const state = (key, title, detail, tone = 'working') => ({ key, title, detail, tone });
  const parallel = s.search ? 'Zároveň hledám: ' + s.search : s.streaming ? 'Zbytek odpovědi ještě připravuji.' : s.voiceWaiting ? 'Další větu připravuji k přehrání.' : s.memoryTasks ? 'Na pozadí ještě aktualizuji paměť.' : 'Odpověď se přehrává.';
  if (!s.awake) return state('ready', 'Připravená', 'Probuď mě a můžeme začít.', 'idle');
  if (s.speaking) return state('speaking', 'Mluvím', parallel, 'speaking');
  if (s.search) return state('searching', 'Hledám na webu', s.search, 'search');
  if (s.reasoning && s.streaming) return state('thinking', 'Přemýšlím', 'Promýšlím odpověď. Ještě chvilku…');
  if (s.voiceWaiting) return state('voice', 'Připravuji hlas', 'Text převádím na řeč. Za chvíli promluvím.', 'voice');
  if (s.streaming) return s.hasText ? state('writing', 'Vytvářím odpověď', 'Odpověď ještě není celá.') : state('thinking', 'Přemýšlím', 'Zprávu mám. Připravuji odpověď.');
  if (s.playing || s.busy) return state('finishing', 'Dokončuji odpověď', s.voiceFailed ? 'Hlas se nepodařilo připravit. Odpověď najdeš v textu.' : 'Ještě zobrazuji nebo dokončuji poslední část.');
  if (s.inputStarting) return state('microphone', 'Zapínám mikrofon', 'Připravuji hlasový vstup.');
  if (s.transcribing) return state('transcribing', 'Přepisuji hlas', 'Počkám na dokončený přepis.', 'voice');
  if (s.hearing) return state('hearing', 'Slyším tě', 'Můžeš pokračovat, poslouchám.', 'listening');
  if (s.inputError) return state('input-error', 'Problém s hlasovým vstupem', s.inputError, 'error');
  if (s.memoryTasks) return state('memory', 'Aktualizuji paměť', 'Odpověď skončila, ještě zpracovávám paměť.');
  if (s.failure) return state('error', 'Odpověď se nedokončila', s.failure, 'error');
  if (s.memoryError) return state('memory-error', 'Paměť se neaktualizovala', 'Odpověď je hotová, ale dokončení paměti se nezdařilo.', 'error');
  if (s.outcome === 'done') return state('done', s.voiceFailed ? 'Hotovo · jen text' : 'Hotovo', s.voiceFailed ? 'Odpověď je v chatu; hlas se nepodařilo přehrát.' : s.listening ? 'Odpověď je dokončená. Poslouchám dál.' : 'Odpověď je dokončená. Můžeš pokračovat.', 'done');
  if (s.listening) return state('listening', 'Poslouchám', s.suppressed ? 'Čekám, až dozní reproduktor.' : 'Mikrofon je zapnutý.', 'listening');
  if (s.outcome === 'interrupted') return state('interrupted', 'Přerušeno', 'Předchozí odpověď jsem zastavila.', 'idle');
  return state('ready', 'Připravená', 'Napiš mi nebo zapni mikrofon.', 'idle');
}
