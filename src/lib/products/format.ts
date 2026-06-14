/**
 * Helpers de formato compartidos entre /productos (list) y
 * /productos/[id] (detail) para que la misma data luzca igual en los
 * dos lados.
 */

const BUNDLE_LABELS: Record<string, string> = {
  kaching_bundles: 'Kaching Bundles',
  reconvert: 'ReConvert',
  bold_bundles: 'Bold Bundles',
  frequently_bought_together: 'Frequently Bought Together',
  rebuy: 'Rebuy',
  generic_bundle: 'Bundle (detectado)',
};

/**
 * Mapea un slug de bundle a su nombre legible. Si el slug es null o
 * desconocido, cae a "Bundle". `generic_bundle` queda como "Bundle
 * (detectado)" para distinguir detección heurística (por título /
 * product_type) de detección por app específica.
 */
export function formatBundleApp(slug: string | null | undefined): string {
  if (!slug) return 'Bundle';
  return BUNDLE_LABELS[slug] ?? 'Bundle';
}

/**
 * Precio con currency. Cae a número decimal si no hay currency o si
 * Intl rechaza el código (la API de Shopify devuelve a veces códigos
 * que Intl no acepta en regiones extrañas).
 */
export function formatPrice(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('es-ES', {
      style: currency ? 'currency' : 'decimal',
      currency: currency ?? 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return amount.toString();
  }
}
