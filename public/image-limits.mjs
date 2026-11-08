// Sdílené limity webu a API. Jde o limit Verity, nikoli pevný limit modelu.
export const MAX_IMAGES = 10;
export const MAX_IMAGE_CHARS = 8_000_000;
export const MAX_IMAGES_CHARS = 16 * 1024 * 1024;
export function requestImages(body) {
  const images = body.images !== undefined ? body.images : body.image == null ? [] : [body.image];
  if (!Array.isArray(images)) throw new Error('Obrázky musí být seznam.');
  if (images.length > MAX_IMAGES) throw new Error('Na jednu zprávu lze přidat nejvýše 10 obrázků.');
  let total = 0;
  for (const image of images) {
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))
      throw new Error('Obrázek musí být JPEG, PNG nebo WebP vložený jako data URL.');
    if (image.length > MAX_IMAGE_CHARS) throw new Error('Jeden obrázek je příliš velký.');
    total += image.length;
  }
  if (total > MAX_IMAGES_CHARS) throw new Error('Obrázky jsou dohromady příliš velké. Odeber některé z nich.');
  return images;
}
