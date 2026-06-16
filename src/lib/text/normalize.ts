/**
 * Lower-case + strip diacritics. Used to normalize Spanish text on
 * both sides of a comparison so "canción" matches "cancion" and
 * "Aníbal" matches "anibal".
 *
 * Lifted out as a shared util because the inbox client-side search
 * and the AI product-routing both want the same definition of
 * "normalized" text.
 */
export function normalize(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks (accents). The `u` flag is required for
    // the unicode property escape.
    .replace(/\p{M}+/gu, '')
}
