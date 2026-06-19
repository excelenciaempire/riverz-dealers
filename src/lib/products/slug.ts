/**
 * Slug de producto — usado para el `handle` (que también es el segmento
 * legible de la URL del editor, /productos/<handle>). Misma lógica en la
 * creación (POST) y el renombrado (PATCH) para que el handle quede estable.
 */
export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'producto'
  );
}

/** Sufijo corto y estable derivado del external_id de un producto manual. */
export function handleSuffix(externalId: number | string): string {
  return Math.abs(Number(externalId)).toString(36).slice(-6);
}

/** ¿El string es un UUID v4 (id real) y no un handle/slug? */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
