// Jednorázové povýšení hlasového hovoru na výchozí režim.
// Mikrofon zapíná až výslovné kliknutí uživatele; tento modul jen nastavuje volby.
export const VOICE_DEFAULTS_VERSION = 1;
export function applyVoiceDefaults(store) {
  if (store.get('voiceDefaultsVersion', 0) === VOICE_DEFAULTS_VERSION) return false;
  const keys = ['live','conv','autoSend','silero','voice','outputMode','think'];
  const previous = Object.fromEntries(keys.map(k=>[k,store.get(k,null)]));
  if (!store.get('voiceDefaultsBackup', null)) store.set('voiceDefaultsBackup', previous);
  store.set('live', true);
  store.set('conv', false);
  store.set('autoSend', true);
  store.set('silero', true);
  store.set('voice', true);
  store.set('outputMode', previous.outputMode === 'headphones' ? 'headphones' : 'aec');
  if (!['off','auto','on'].includes(previous.think)) store.set('think','auto');
  store.set('voiceDefaultsVersion', VOICE_DEFAULTS_VERSION);
  return true;
}
export function microphoneLabel({liveMode, active, starting, finishing, supported}) {
  if(!supported)return 'Mikrofon není dostupný';
  if(starting)return 'Zrušit zapínání';
  if(finishing)return 'Dokončuji přepis';
  if(active)return liveMode?'Ukončit hovor':'Dokončit nahrávání';
  return liveMode?'Začít mluvit':'Nahrát zprávu';
}

export function needsEchoFallback(mode,confirmed) {
  return mode === 'aec' && confirmed !== true && confirmed !== 'all';
}

export function microphoneError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Povol mikrofon v prohlížeči a zkus to znovu.';
  if (error?.name === 'NotFoundError') return 'Nenašla jsem mikrofon. Připoj ho, nebo mi napiš zprávu.';
  if (error?.name === 'NotReadableError') return 'Mikrofon je obsazený nebo nedostupný. Zkus zavřít jiný hovor.';
  return 'Mikrofon nejde zapnout: ' + (error?.message || 'neznámá chyba');
}
