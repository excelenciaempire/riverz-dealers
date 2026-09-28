import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/channels/publicacion', () => ({ briefDePublicacionPorOrigen: vi.fn(async () => 'Exact post') }));
import { safePostLink, loadCommentSource, commentBriefForTurn } from './provenance';

it('accepts only HTTPS links to real social hosts, never lookalikes or executable URLs', () => {
  expect(safePostLink('https://www.instagram.com/p/one/')).toContain('/p/one/');
  expect(safePostLink('https://www.facebook.com/post/123')).toContain('facebook.com');
  for (const value of ['javascript:alert(1)', 'https://instagram.com.evil.test/p/1', 'http://instagram.com/p/1', '/p/1', null]) expect(safePostLink(value)).toBeNull();
});

function fixture(data: Record<string, unknown>) {
  const calls: unknown[][] = [];
  const db = { from(table: string) {
    const q = { select: () => q, eq: (...args: unknown[]) => { calls.push([table, ...args]); return q; },
      is: () => q, in: () => q, not: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: data[table] ?? null, error: null }) };
    return q;
  } } as unknown as SupabaseClient;
  return { db, calls };
}

it('uses exact message metadata, not the grouped conversation first post, and scopes every lookup', async () => {
  const { db, calls } = fixture({ messages: { id: 'comment', channel: 'ig_comment', conversation_id: 'public', created_at: 'now', content_text: 'Pregunta' },
    comments_meta: { post_id: 'actual-post', connection_id: 'actual-page', permalink: 'https://instagram.com/p/actual/' },
    publicacion_contexto: { cuerpo: 'Caption exacto' } });
  expect(await loadCommentSource(db, 'merchant', 'comment')).toMatchObject({ postId: 'actual-post', connectionId: 'actual-page', caption: 'Caption exacto' });
  expect(calls).toContainEqual(['messages', 'conversations.workspace_id', 'merchant']);
  expect(calls).toContainEqual(['publicacion_contexto', 'workspace_id', 'merchant']);
});

it('never guesses a private origin from unrelated messages', async () => {
  const { db } = fixture({ conversations: { channel: 'instagram' } });
  expect(await commentBriefForTurn(db, 'merchant', 'private')).toBeNull();
});

it('does not inject a comment belonging to another conversation', async () => {
  const { db } = fixture({ conversations: { channel: 'ig_comment' }, messages: { id: 'comment', channel: 'ig_comment', conversation_id: 'other' }, comments_meta: { post_id: 'post' } });
  expect(await commentBriefForTurn(db, 'merchant', 'public', 'comment')).toBeNull();
});

it('manual drafting uses the latest inbound comment instead of a grouped thread first post', async () => {
  const { db, calls } = fixture({ conversations: { channel: 'ig_comment' },
    messages: { id: 'latest-comment', channel: 'ig_comment', conversation_id: 'public' },
    comments_meta: { post_id: 'latest-post' } });
  expect(await commentBriefForTurn(db, 'merchant', 'public')).toBe('Exact post');
  expect(calls).toContainEqual(['messages', 'sender_type', 'customer']);
  expect(calls).toContainEqual(['messages', 'id', 'latest-comment']);
});
