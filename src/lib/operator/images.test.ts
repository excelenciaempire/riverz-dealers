import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { imageContent, type OperatorImage } from './images'
import { normalizeOperatorImages, readOperatorBody } from './images-server'
import { toAnthropic } from './threads'

describe('operator image context', () => {
  it('decodes real image bytes, bounds dimensions and removes metadata', async () => {
    const bytes = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: 'red' } }).png().toBuffer()
    const [image] = await normalizeOperatorImages([{ name: 'capture.png', mediaType: 'wrong', data: bytes.toString('base64') }])
    const metadata = await sharp(Buffer.from(image.data, 'base64')).metadata()
    expect(image.mediaType).toBe('image/jpeg')
    expect(metadata.width).toBe(1568)
    expect(metadata.exif).toBeUndefined()
  })

  it.each([null, {}, [1], [{ data: 'https://internal/image.png' }], [{ data: Buffer.from('not an image').toString('base64') }], [{}, {}, {}, {}]])('rejects malformed images and remote references: %j', async (input) => {
    await expect(normalizeOperatorImages(input)).rejects.toThrow()
  })

  it('keeps image-only messages and prior images together with follow-up context', () => {
    const image: OperatorImage = { name: 'capture.png', mediaType: 'image/png', data: 'YWJj' }
    const context = toAnthropic([
      { id: '1', role: 'user', text: '', images: [image], created_at: '' },
      { id: '2', role: 'assistant', text: 'The screenshot shows an error.', created_at: '' },
      { id: '3', role: 'user', text: 'How do I fix that error?', created_at: '' },
    ])
    expect(context).toHaveLength(3)
    expect(context[0].content).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }])
    expect(context[2].content).toBe('How do I fix that error?')
    expect(imageContent('Look here', [image])).toEqual([
      ...(context[0].content as unknown[]), { type: 'text', text: 'Look here' },
    ])
  })

  it('keeps existing text-only requests compatible and rejects oversized bodies', async () => {
    expect(await readOperatorBody(new Request('https://riverz.co', { method: 'POST', body: '{"texto":"hola"}' }))).toEqual({ texto: 'hola' })
    await expect(readOperatorBody(new Request('https://riverz.co', { method: 'POST', headers: { 'content-length': '30000000' }, body: '{}' }))).rejects.toThrow()
  })
})
