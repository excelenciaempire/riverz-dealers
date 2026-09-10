export interface CatalogVariant {
  id: string | null;
  title: string;
  options: Record<string, string>;
  price: number | null;
  available: boolean;
}

interface RawOption {
  name?: unknown;
}

interface RawVariant {
  id?: unknown;
  title?: unknown;
  option1?: unknown;
  option2?: unknown;
  option3?: unknown;
  price?: unknown;
  inventory_management?: unknown;
  inventory_policy?: unknown;
  inventory_quantity?: unknown;
}

interface RawProduct {
  status?: unknown;
  published_at?: unknown;
  options?: unknown;
  variants?: unknown;
}

function text(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Opciones publicadas de una ficha Shopify, con disponibilidad real.
 *
 * Shopify considera vendible una variante si no controla inventario, si aún
 * tiene unidades o si su política permite continuar vendiendo sin stock.
 * Un producto borrador o no publicado no expone variantes al agente.
 */
export function shopifyCatalogVariants(raw: unknown): CatalogVariant[] {
  if (!raw || typeof raw !== 'object') return [];
  const product = raw as RawProduct;
  if (
    text(product.status).toLowerCase() !== 'active' ||
    !product.published_at
  ) {
    return [];
  }

  const optionNames = Array.isArray(product.options)
    ? (product.options as RawOption[]).map(
        (option, index) => text(option.name) || `Opción ${index + 1}`
      )
    : [];
  const variants = Array.isArray(product.variants)
    ? (product.variants as RawVariant[])
    : [];

  return variants.flatMap((variant) => {
    const title = text(variant.title);
    if (!title) return [];
    const options: Record<string, string> = {};
    for (let index = 0; index < 3; index += 1) {
      const value = text(variant[`option${index + 1}` as keyof RawVariant]);
      if (value) options[optionNames[index] || `Opción ${index + 1}`] = value;
    }
    const quantity = number(variant.inventory_quantity) ?? 0;
    const tracksInventory = Boolean(text(variant.inventory_management));
    const available =
      !tracksInventory ||
      quantity > 0 ||
      text(variant.inventory_policy).toLowerCase() === 'continue';

    return [
      {
        id: text(variant.id) || null,
        title,
        options,
        price: number(variant.price),
        available,
      },
    ];
  });
}

/** Texto compacto y explícito para el prompt del agente. */
export function formatShopifyVariants(raw: unknown): string {
  const variants = shopifyCatalogVariants(raw);
  if (variants.length === 0) return '';
  const render = (variant: CatalogVariant) => {
    const options = Object.entries(variant.options)
      .map(([name, value]) => `${name}: ${value}`)
      .join(', ');
    return options || variant.title;
  };
  const available = variants.filter((variant) => variant.available).map(render);
  const unavailable = variants
    .filter((variant) => !variant.available)
    .map(render);
  return [
    available.length
      ? `Variantes disponibles: ${available.join(' | ')}`
      : 'Variantes disponibles: ninguna',
    unavailable.length ? `Variantes agotadas: ${unavailable.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('. ');
}
