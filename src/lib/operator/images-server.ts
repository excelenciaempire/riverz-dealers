import sharp from 'sharp'
import { MAX_OPERATOR_IMAGES, MAX_OPERATOR_IMAGE_BYTES, type OperatorImage } from './images'

export async function readOperatorBody(request: Request): Promise<unknown> {
  const maxBytes = MAX_OPERATOR_IMAGES * Math.ceil(MAX_OPERATOR_IMAGE_BYTES / 3) * 4 + 64 * 1024
  if (Number(request.headers.get('content-length')) > maxBytes) throw new Error('invalid_images')
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('invalid_images')
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Decode actual pixels, strip metadata and bound persisted/model payloads. */
export async function normalizeOperatorImages(value: unknown): Promise<OperatorImage[]> {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_OPERATOR_IMAGES) throw new Error('invalid_images')
  return Promise.all(value.map(async (image: unknown) => {
    if (!image || typeof image !== 'object') throw new Error('invalid_images')
    const raw = image as Record<string, unknown>
    if (typeof raw.data !== 'string' || raw.data.length > Math.ceil(MAX_OPERATOR_IMAGE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data) || raw.data.length % 4 !== 0) throw new Error('invalid_images')
    const bytes = Buffer.from(raw.data, 'base64')
    if (bytes.length > MAX_OPERATOR_IMAGE_BYTES) throw new Error('invalid_images')
    const decoder = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' })
    const metadata = await decoder.metadata()
    if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format ?? '')) throw new Error('invalid_images')
    let output = await decoder.rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    if (output.length > 512 * 1024) {
      output = await sharp(output).resize({ width: 1280, height: 1280, fit: 'inside' }).jpeg({ quality: 65 }).toBuffer()
    }
    if (output.length > 512 * 1024) throw new Error('invalid_images')
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '',
      mediaType: 'image/jpeg' as const,
      data: output.toString('base64'),
    }
  }))
}
