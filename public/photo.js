// Fotky pro Verity (vision): foťák / webkamera, galerie / soubor, vložení Ctrl+V, přetažení.
// Každá fotka se před odesláním zmenší (max 1280 px, JPEG) a k ní se udělá miniatura do historie.
//  - telefon: 📷 otevře přímo foťák (<input capture>), 🖼 galerii
//  - počítač: 📷 otevře webkameru s živým náhledem (getUserMedia), 🖼 výběr souboru

const MAX_SIDE = 1280, THUMB_SIDE = 160;
const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer: coarse)').matches;

function render(src, w, h, max, quality) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

async function decode(blob) {
  // createImageBitmap respektuje EXIF otočení fotek z mobilu
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* starší prohlížeč */ }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Obrázek nejde načíst.'));
    img.src = URL.createObjectURL(blob);
  });
}

export async function prepareBlob(blob) {
  if (!blob || !/^image\//.test(blob.type)) throw new Error('Tohle není obrázek.');
  if (blob.size > 30 * 1024 * 1024) throw new Error('Obrázek je moc velký (max 30 MB).');
  const bmp = await decode(blob);
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  return { image: render(bmp, w, h, MAX_SIDE, 0.85), thumb: render(bmp, w, h, THUMB_SIDE, 0.7) };
}

function prepareVideo(video) {
  const w = video.videoWidth, h = video.videoHeight;
  return { image: render(video, w, h, MAX_SIDE, 0.85), thumb: render(video, w, h, THUMB_SIDE, 0.7) };
}

// ── webkamera (počítač) ──────────────────────────────────────────────────────
let stream = null, facing = 'user';
async function openWebcam(onPhoto, onError) {
  const modal = $('webcam'), video = $('webcam-video');
  const start = async () => {
    stream?.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    video.srcObject = stream;
    await video.play();
  };
  const close = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; modal.hidden = true; };
  try {
    modal.hidden = false;
    await start();
  } catch (e) {
    close();
    // bez kamery → aspoň výběr souboru
    onError(e.name === 'NotAllowedError' ? 'Kamera není povolená – povol ji v prohlížeči.' : 'Kamera není k dispozici, vyber fotku ze souboru.');
    $('cam-file').click();
    return;
  }
  $('webcam-shot').onclick = () => { const p = prepareVideo(video); close(); onPhoto(p); };
  $('webcam-flip').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; try { await start(); } catch { /* jen jedna kamera */ } };
  $('webcam-cancel').onclick = close;
}

export function setupPhoto({ onPhoto, onError = () => {} }) {
  const handleFiles = async files => {
    const f = [...(files || [])].find(x => /^image\//.test(x.type));
    if (!f) return;
    try { onPhoto(await prepareBlob(f)); } catch (e) { onError(e.message); }
  };
  $('pic-file').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
  $('cam-file').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
  $('pic').onclick = () => $('pic-file').click();
  $('cam').onclick = () => {
    if (touch || !navigator.mediaDevices?.getUserMedia) $('cam-file').click();   // telefon: nativní foťák
    else openWebcam(onPhoto, onError);
  };
  // Ctrl+V obrázku a přetažení souboru do okna
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); handleFiles([item.getAsFile()]); }
  });
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) { e.preventDefault(); document.body.classList.add('dropping'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', e => { document.body.classList.remove('dropping'); if (e.dataTransfer.files?.length) { e.preventDefault(); handleFiles(e.dataTransfer.files); } });
}
