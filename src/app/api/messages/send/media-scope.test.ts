import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ adapter: vi.fn(), tables: [] as string[] }));
const workspace = '11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
}) }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en', safeLocale: async () => 'en' }));
vi.mock('@/lib/channels/registry', () => ({ getAdapter: mocks.adapter }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({
  from: (table: string) => {
    mocks.tables.push(table);
    if (!['conversations', 'workspace_members'].includes(table)) throw new Error('unexpected database access');
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({
      data: table === 'conversations' ? { id: 'conversation', workspace_id: workspace } : { id: 'membership' },
    }) };
    return chain;
  },
}) }));
import { POST } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.tables = []; });

it.each([
  '/api/media/22222222-2222-4222-8222-222222222222/thread/proof.pdf',
  'https://ref.supabase.co/storage/v1/object/public/message-media/22222222-2222-4222-8222-222222222222/thread/proof.pdf',
  `/api/media/${workspace}/%252e%252e/another/proof.pdf`,
])('rejects a foreign or traversal attachment before any outbound operation: %s', async url => {
  const response = await POST(new Request('https://riverz.test/api/messages/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversation_id: 'conversation', media: { url, mediaType: 'document' } }),
  }));
  expect(response.status).toBe(403);
  expect(mocks.tables).toEqual(['conversations', 'workspace_members']);
  expect(mocks.adapter).not.toHaveBeenCalled();
});
