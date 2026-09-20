import { downloadPublicMedia } from '@/lib/security/download-public-media';

/** count_tokens accepts inline images/PDFs, but unlike messages rejects URL sources. */
export async function inlineCountableMedia(messages: unknown): Promise<boolean> {
  let changed = false;
  let totalBytes = 0;
  const cache = new Map<string, { type: 'base64'; media_type: string; data: string }>();
  async function visit(value: unknown): Promise<void> {
    if (Array.isArray(value)) {
      for (const item of value) await visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const block = value as Record<string, unknown>;
    const source = block.source as Record<string, unknown> | undefined;
    if ((block.type === 'image' || block.type === 'document') && source?.type === 'url') {
      if (typeof source.url !== 'string') throw new Error('wallet_invalid_media_url');
      const key = `${block.type}:${source.url}`;
      let inline = cache.get(key);
      if (!inline) {
        const media = await downloadPublicMedia(source.url, block.type === 'image' ? 5 * 1024 * 1024 : 20 * 1024 * 1024, 10_000);
        if (!media) throw new Error('wallet_media_download_failed');
        const mime = media.mime.split(';')[0].trim().toLowerCase();
        const allowed = block.type === 'image'
          ? ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
          : ['application/pdf'];
        if (!allowed.includes(mime)) throw new Error('wallet_unsupported_media_type');
        inline = { type: 'base64', media_type: mime, data: media.buffer.toString('base64') };
        cache.set(key, inline);
      }
      totalBytes += inline.data.length;
      if (totalBytes > 28 * 1024 * 1024) throw new Error('wallet_media_payload_too_large');
      block.source = inline;
      changed = true;
    }
    // Message and tool_result content may both contain media blocks.
    if (block.content) await visit(block.content);
  }
  await visit(messages);
  return changed;
}
