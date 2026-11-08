// Jen obsah právě viditelné výměny; kompletní historii dál spravuje chat.
export class CaptionState {
  constructor() { this.reply = ''; this.latestUser = ''; }
  beginReply() { this.reply = ''; }
  addSegment(text) {
    const clean = String(text || '').replace(/\s+/g,' ').trim();
    if (clean) this.reply = [this.reply, clean].filter(Boolean).join(' ');
    return this.reply;
  }
  rememberUser(text) {
    const clean = String(text || '').trim();
    if (clean) this.latestUser = clean;
  }
  userView(draft, { capturing = false, finishing = false } = {}) {
    const text = String(draft || '').trim();
    return {
      text: text || this.latestUser || 'Tady uvidíš přepis svého mikrofonu.',
      label: text ? (finishing ? 'Ty · dokončuji' : capturing ? 'Ty · živě' : 'Ty · rozepsáno') : 'Ty',
      placeholder: !text && !this.latestUser,
    };
  }
}
