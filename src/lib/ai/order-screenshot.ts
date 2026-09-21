import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { ShopifyAdminClient } from '../shopify/admin-client';
import { lookupCustomerOrders, type OrderSummary } from '../shopify/order-lookup';

export interface OrderScreenshot { order: string; png: Buffer; caption: string }
export function orderScreenshotMessageId(conversationId: string, inboundId: string, order: string): string {
  const hash = createHash('sha256').update(JSON.stringify(['order-screenshot-v1', conversationId, inboundId, order])).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const lines = (s: string) => s.replace(/[\r\n]+/g, ' ').match(/.{1,48}(?:\s|$)|.{1,48}/gu)?.slice(0, 3) ?? [];

/** A snapshot of verified order rows, never an admin page or model-generated photo. */
export async function renderOrderScreenshot(order: OrderSummary, photos: Array<Buffer | null>, language: string): Promise<Buffer> {
  if (!order.line_items.length || order.line_items.length > 12) throw new Error('unsupported_order_size');
  const en = language.startsWith('en');
  const height = 130 + order.line_items.length * 190;
  const rows = order.line_items.map((item, i) => {
    const y = 95 + i * 190;
    return `<line x1="24" x2="876" y1="${y - 15}" y2="${y - 15}" stroke="#ddd"/>
      ${lines(item.title).map((line, j) => `<text x="195" y="${y + 20 + j * 27}" font-size="21">${xml(line)}</text>`).join('')}
      <text x="195" y="${y + 112}" font-size="22" font-weight="bold">${xml((item.variant_title || '').slice(0, 65))}</text>
      <text x="195" y="${y + 148}" font-size="20">${en ? 'Quantity' : 'Cantidad'}: ${item.quantity}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" fill="#171717"><text x="24" y="44" font-size="26" font-weight="bold">${en ? 'Order' : 'Pedido'} ${xml(order.name)}</text>${rows}</g></svg>`;
  const composites = await Promise.all(photos.slice(0, order.line_items.length).map(async (photo, i) => photo ? {
    input: await sharp(photo, { limitInputPixels: 25_000_000 }).rotate().resize(145, 145, { fit: 'contain', background: '#ffffff' }).png().toBuffer(),
    left: 24, top: 95 + i * 190,
  } : null));
  return sharp(Buffer.from(svg)).composite(composites.filter(x => x !== null)).png().toBuffer();
}

export async function captureCustomerOrder(input: {
  shopDomain: string; accessToken: string; apiVersion: string;
  customerPhone?: string; customerEmail?: string; orderNumber: string; language: string;
}): Promise<OrderScreenshot> {
  if (!/^#?\d{1,12}$/.test(input.orderNumber)) throw new Error('invalid_order_number');
  const result = await lookupCustomerOrders(input);
  const order = result.orders.find(o => o.name.replace(/^#/, '') === input.orderNumber.replace(/^#/, ''));
  if (!order) throw new Error('order_not_owned_or_unavailable');
  if (!order.line_items.length || order.line_items.length > 12) throw new Error('unsupported_order_size');
  const client = new ShopifyAdminClient(input.shopDomain, input.accessToken, input.apiVersion);
  const photos = await Promise.all(order.line_items.map(async item => {
    if (!item.product_id || !item.variant_id) return null;
    try {
      const { product } = await client.rest<{ product: { images: Array<{ src: string; variant_ids: Array<number | string> }> } }>(`/products/${item.product_id}.json?fields=id,images`);
      // No fallback to the cover: it may show a different color.
      const src = product.images.find(p => p.variant_ids.some(id => String(id) === item.variant_id))?.src;
      if (!src) return null;
      const url = new URL(src);
      if (url.protocol !== 'https:' || url.hostname !== 'cdn.shopify.com' || url.port) return null;
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 5_000_000) return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const parts: Buffer[] = []; let bytes = 0;
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 5_000_000) { await reader.cancel(); return null; }
        parts.push(Buffer.from(part.value));
      }
      return Buffer.concat(parts);
    } catch { return null; }
  }));
  return { order: order.name, png: await renderOrderScreenshot(order, photos, input.language), caption: `${input.language.startsWith('en') ? 'Order' : 'Pedido'} ${order.name}` };
}
