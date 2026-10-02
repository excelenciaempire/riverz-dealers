import { z } from 'zod';
import { OUTCOME_CATEGORIES } from './outcomes';
export const dashboardHeaders = { 'Cache-Control': 'private, no-store' };
export const outcomeDecision = z.object({ conversationId: z.string().uuid(), lastMessageId: z.string().uuid(),
  category: z.enum(OUTCOME_CATEGORIES).nullable() }).strict();
export function outcomeRange(request: Request) {
  const entries = [...new URL(request.url).searchParams];
  if (entries.length !== 2 || new Set(entries.map(([key]) => key)).size !== 2 || entries.some(([key]) => !['start', 'end'].includes(key))) return null;
  const input = Object.fromEntries(entries), start = Date.parse(input.start), end = Date.parse(input.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start: new Date(start).toISOString(), end: new Date(end).toISOString() } : null;
}
export async function outcomeBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return null;
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return null; } chunks.push(chunk.value); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; } finally { reader.releaseLock(); }
}
