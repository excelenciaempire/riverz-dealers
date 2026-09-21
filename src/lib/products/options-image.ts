import { createHash } from 'node:crypto';
import sharp, { type OverlayOptions } from 'sharp';
import { downloadPublicMedia } from '@/lib/security/download-public-media';

export interface ProductVisualOption {
  label: string;
  image: string;
}

export interface ProductOptionsImage {
  productId: string;
  png: Buffer;
  caption: string;
}

export function productOptionsMessageId(
  conversationId: string,
  inboundId: string,
  productId: string,
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(['product-options-v1', conversationId, inboundId, productId]))
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const xml = (value: string) =>
  value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[
      character
    ]!,
  );

async function downloadProductImage(urlString: string): Promise<Buffer> {
  const media = await downloadPublicMedia(urlString, 5_000_000, 10_000);
  if (!media || !media.mime.toLocaleLowerCase().startsWith('image/')) {
    throw new Error('product_image_unavailable');
  }
  return media.buffer;
}

/** Crea una sola lámina clara para comparar variantes sin enumerarlas a ciegas. */
export async function renderProductOptionsImage(input: {
  productId: string;
  title: string;
  options: ProductVisualOption[];
  language?: string | null;
}): Promise<ProductOptionsImage> {
  const options = input.options.slice(0, 6);
  if (options.length < 2) throw new Error('not_enough_visual_options');
  const columns = options.length === 2 ? 2 : 3;
  const rows = Math.ceil(options.length / columns);
  const tileWidth = 440;
  const tileHeight = 500;
  const headerHeight = 105;
  const width = columns * tileWidth;
  const height = headerHeight + rows * tileHeight;
  const photos = await Promise.all(options.map((option) => downloadProductImage(option.image)));
  const background = await sharp({
    create: { width, height, channels: 3, background: '#f6f6f4' },
  })
    .png()
    .toBuffer();
  const composites: OverlayOptions[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * tileWidth;
    const top = headerHeight + row * tileHeight;
    composites.push({
      input: await sharp(photos[index], { limitInputPixels: 25_000_000 })
        .rotate()
        .resize(tileWidth - 28, tileHeight - 82, {
          fit: 'contain',
          background: '#ffffff',
        })
        .png()
        .toBuffer(),
      left: left + 14,
      top: top + 14,
    });
  }
  const labels = options
    .map((option, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * tileWidth + tileWidth / 2;
      const y = headerHeight + row * tileHeight + tileHeight - 26;
      return `<text x="${x}" y="${y}" text-anchor="middle" font-size="29" font-weight="700">${xml(option.label)}</text>`;
    })
    .join('');
  const title = input.language?.startsWith('en') ? 'Available options' : 'Opciones disponibles';
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Arial, sans-serif" fill="#171717"><text x="${width / 2}" y="62" text-anchor="middle" font-size="38" font-weight="700">${title}</text>${labels}</g></svg>`,
  );
  return {
    productId: input.productId,
    png: await sharp(background).composite([...composites, { input: overlay, left: 0, top: 0 }]).png().toBuffer(),
    caption: input.language?.startsWith('en') ? 'Available colors' : 'Colores disponibles',
  };
}
