import 'server-only';
import { downloadPublicMedia } from '@/lib/security/download-public-media';

/** Server-only bytes for a URL obtained from the authenticated Graph API. */
export async function downloadMedia(args: {
  downloadUrl: string;
  accessToken: string;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const file = await downloadPublicMedia(args.downloadUrl, 25 * 1024 * 1024, 20_000, {
    Authorization: `Bearer ${args.accessToken}`,
  });
  if (!file) throw new Error('Media download unavailable or exceeds limit');
  return { buffer: file.buffer, contentType: file.mime };
}
