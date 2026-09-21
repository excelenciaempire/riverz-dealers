import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
const services = vi.hoisted(() => ({ transcribe: vi.fn(), describe: vi.fn(), resolve: vi.fn() }));
vi.mock('./transcribe', () => ({ transcribeAudio: services.transcribe }));
vi.mock('./platform-key', () => ({ resolveAnthropicKey: services.resolve }));
vi.mock('./llm-client', () => ({ describeImage: services.describe }));
vi.mock('@/lib/channels/media-url', () => ({ resolveMediaFetchUrl: async (url: string) => url }));
import { enrichConversationEvidence, evidenceText, type EvidenceRow } from './conversation-evidence';

function database(rows: EvidenceRow[], owner = true) {
  const writes: Array<Record<string, unknown>> = [];
  const from = vi.fn((table: string) => {
    const q = {
      select: vi.fn(() => q), eq: vi.fn(() => q), in: vi.fn(() => q), order: vi.fn(() => q),
      limit: vi.fn(async () => ({ data: rows, error: null })),
      maybeSingle: vi.fn(async () => ({ data: table === 'conversations' && owner ? { id: 'chat' } : null, error: null })),
      update: vi.fn((patch: Record<string, unknown>) => { writes.push(patch); return q; }),
    };
    return q;
  });
  return { db: { from } as unknown as SupabaseClient, writes, from };
}
const scope = { workspaceId: 'shop', conversationId: 'chat' };
beforeEach(() => { vi.clearAllMocks(); services.resolve.mockResolvedValue(null); services.transcribe.mockResolvedValue({ text: 'Uno negro y otro negro con blanco.' }); });
afterEach(() => vi.unstubAllGlobals());
describe('media processing without permission to send', () => {
  it('analyzes a newly sent human image and saves the observation, not an order confirmation', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/png' } })));
    services.resolve.mockResolvedValue({ key: 'test-key', source: 'platform' });
    services.describe.mockResolvedValue({ text: 'Dos pares Negro, talla 39.' });
    const { db, writes } = database([{ id: 'human', media_url: 'https://media.test/image.png', media_mime: 'image/png' }]);
    await enrichConversationEvidence(db, scope);
    expect(services.describe).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writes)).toContain('Dos pares Negro, talla 39.');
    expect(Object.keys(writes[0])).toEqual(['attachments']);
  });
  it('transcribes and caches all voice attachments without sending or changing conversation state', async () => {
    const { db, writes } = database([{ id: 'audio', media_url: '/one', media_type: 'voice', attachments: [{ url: '/one', mime_type: 'audio/ogg' }, { url: '/two', mime_type: 'audio/ogg' }] }]);
    await enrichConversationEvidence(db, scope);
    expect(services.transcribe).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(1);
    expect(writes[0].media_transcription).toBe('Uno negro y otro negro con blanco.');
    expect(Object.keys(writes[0]).sort()).toEqual(['attachments', 'media_transcription']);
  });
  it('uses the existing transcription without paying for it again', async () => {
    const { db, writes } = database([{ id: 'audio', media_url: '/one', media_type: 'voice', media_transcription: 'Sí, ambos 39' }]);
    await enrichConversationEvidence(db, scope);
    expect(services.transcribe).not.toHaveBeenCalled();
    expect(JSON.stringify(writes)).toContain('Sí, ambos 39');
  });
  it('does not overwrite original text or pretend a failed analysis succeeded', async () => {
    services.transcribe.mockResolvedValue(null);
    const row = { id: 'audio', content_text: '[Audio]', media_url: '/one', media_type: 'voice' };
    const { db, writes } = database([row]);
    await enrichConversationEvidence(db, scope);
    expect(writes).toEqual([]);
    expect(evidenceText(row)).toContain('pendiente de interpretar');
  });
  it('does not read media from another workspace', async () => {
    const { db, from } = database([{ id: 'audio', media_url: '/one', media_type: 'voice' }], false);
    await enrichConversationEvidence(db, scope);
    expect(from).toHaveBeenCalledTimes(1);
    expect(services.transcribe).not.toHaveBeenCalled();
  });
  it('keeps every cached image, including human attachments without media_type', async () => {
    const row: EvidenceRow = { id: 'human', media_url: '/one', attachments: [{ url: '/one', mime_type: 'image/png', evidence: { version: 1, kind: 'image', text: 'Pedido 1008: Negro 39 + Negro con blanco 39' } }] };
    const { db, writes } = database([row]);
    await enrichConversationEvidence(db, scope);
    expect(writes).toEqual([]);
    expect(evidenceText(row)).toContain('Pedido 1008');
  });
});
