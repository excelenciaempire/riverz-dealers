import type { Locale } from '@/lib/i18n/config';
import { confirmationSummary } from '@/lib/shopify/confirmation-summary';

type Row = Record<string, unknown>;
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r)) : [];

export function purchaseLines(value: unknown): Row[] {
  try { return rows(typeof value === 'string' ? JSON.parse(value) : value); }
  catch { return []; }
}

/** Match IDs, never titles or the first catalog image of another color. */
export function purchasedVariantImage(line: Row, product: Row): string | null {
  if (!line.product_id || String(product.id) !== String(line.product_id) || !line.variant_id) return null;
  const variant = rows(product.variants).find(v => String(v.id) === String(line.variant_id));
  if (!variant) return null;
  const images = rows(product.images);
  const image = (variant.image_id ? images.find(i => String(i.id) === String(variant.image_id)) : undefined)
    || images.find(i => Array.isArray(i.variant_ids) && i.variant_ids.some(id => String(id) === String(line.variant_id)));
  if (!image) return null;
  try {
    const url = new URL(clean(image.src));
    return url.protocol === 'https:' && url.hostname === 'cdn.shopify.com' ? url.href : null;
  } catch { return null; }
}

export function purchaseLineSummary(line: Row) {
  return confirmationSummary({ line_items: [line] }).order_items;
}

/** Fixed line breaks belong to the approved body, never Meta parameter values. */
export function purchaseConfirmationTemplates(locale: Locale) {
  const en = locale === 'en';
  const buttons = [{ type: 'QUICK_REPLY' as const, text: en ? 'CONFIRM' : 'CONFIRMAR' },
    { type: 'QUICK_REPLY' as const, text: en ? 'CORRECT' : 'CORREGIR' }];
  const summaries = [1, 2, 0].map(count => {
    const itemFields = count === 2 ? ['purchase_item_1', 'purchase_item_2'] : count === 1 ? ['purchase_item_1'] : ['order_items'];
    const offset = itemFields.length;
    return {
      name: `deuna_resumen_compra_${count || 'general'}_v1`, language: locale,
      headerType: 'none' as const,
      body: en
        ? `Hi, {{1}}! Thanks for your purchase.\n\n*Your order*\n• {{2}}${count === 2 ? '\n• {{3}}' : ''}\n\n*Total to pay on delivery*\n{{${2 + offset}}}\n\n*Delivery address*\n{{${3 + offset}}}\n\n*Phone*\n{{${4 + offset}}}\n\nCheck your items and delivery details.\nTap CONFIRM if they are correct or CORRECT to request a change.`
        : `Hola, {{1}}. ¡Gracias por tu compra!\n\n*Tu pedido*\n• {{2}}${count === 2 ? '\n• {{3}}' : ''}\n\n*Total a pagar al recibir*\n{{${2 + offset}}}\n\n*Dirección de entrega*\n{{${3 + offset}}}\n\n*Teléfono*\n{{${4 + offset}}}\n\nRevisa los productos y tus datos.\nToca CONFIRMAR si están correctos o CORREGIR para solicitar un cambio.`,
      fields: ['recipient_first_name', ...itemFields, 'total_price_display', 'delivery_address', 'delivery_phone'],
      samples: ['Luz', en ? '1 × Puma Suede XL (White / 36)' : '1 × Puma Suede XL (Blanco / 36)',
        ...(count === 2 ? [en ? '1 × Puma Suede XL (Black and white / 37)' : '1 × Puma Suede XL (Negro con blanco / 37)'] : []),
        en ? '249,900 COP' : '249.900 COP', 'Calle 10 # 20-30, Cúcuta', '573000000000'],
      buttons,
    };
  });
  return [...summaries, {
    name: 'deuna_foto_referencia_v1', language: locale, headerType: 'image' as const,
    body: en ? '*Item from your order*\n{{1}}\n\nPlease check that it matches your selection.'
      : '*Referencia de tu pedido*\n{{1}}\n\nRevisa que corresponda a tu selección.',
    fields: ['purchase_item'], samples: [en ? '1 × Puma Suede XL (White / 36)' : '1 × Puma Suede XL (Blanco / 36)'],
    buttons: [],
  }];
}
