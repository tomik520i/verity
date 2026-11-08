// Výslovná změna tónu platí i pro další tahy; citovaná řeč ji nemění.
export function roleplayPreference(text, paused = false) {
  if (typeof text !== 'string' || text.trim().startsWith('[[')) return paused;
  const t=text.replace(/„[^“]*“|"[^"]*"|“[^”]*”|«[^»]*»/g,' ')
    .normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  if (/\b(?:zapni|vrat|obnov|chci|pokracuj|zpatky).{0,25}\b(?:horor|roleplay|roli)\b/.test(t) && !/\b(?:nechci|nezapinej|nevracej)\b/.test(t)) return false;
  if (/\b(?:mluv|povidej|bavme se|chci mluvit).{0,25}\b(?:normalne|bez hororu)\b|\bprestan.{0,20}\bstrasit\b|\bnechci.{0,15}\bhoror\b|\b(?:vypni|ukonci).{0,20}\b(?:horor|roleplay)\b/.test(t) && !/\bnemluv\b/.test(t)) return true;
  return paused;
}
