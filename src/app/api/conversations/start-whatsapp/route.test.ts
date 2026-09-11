import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  send: vi.fn(), short: vi.fn(), from: vi.fn(), template: {} as Record<string, unknown>,
  filters: [] as unknown[][],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }));
vi.mock('@/lib/channels/encryption', () => ({ decrypt: () => 'test-token' }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage: mocks.send, sendTextMessage: vi.fn() }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => 'workspace' }));
vi.mock('@/lib/marketing/enlaces-salientes', () => ({ prepararTextoParaCanal: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/i18n/translate', () => ({ translate: (_: string, key: string) => key }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: vi.fn(), RATE_LIMITS: { send: {} } }));
vi.mock('@/lib/links/short-link', () => ({ createShortLink: mocks.short }));
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters = [];
  mocks.template = { name: 'cart', language: 'es', body_text: 'Hola {{1}}',
    buttons: [{ type: 'URL', text: 'Retomar compra', url: 'https://riverz.co/r/{{1}}' }] };
  mocks.short.mockResolvedValue('customer-token');
  mocks.send.mockResolvedValue({ messageId: 'wamid.test' });
  mocks.from.mockImplementation((table: string) => {
    const rows: Record<string, unknown> = {
      channel_connections: { id: 'connection', config: { phone_number_id: 'phone' }, secrets: { access_token: 'encrypted' } },
      contacts: { id: 'contact', name: 'Juan' }, conversations: { id: 'conversation' },
      message_templates: mocks.template, messages: null,
    };
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'neq', 'order', 'limit', 'insert', 'update']) {
      q[method] = (...args: unknown[]) => { mocks.filters.push([table, method, ...args]); return q; };
    }
    q.maybeSingle = async () => ({ data: rows[table] });
    q.single = async () => ({ data: { id: 'message' } });
    return q;
  });
});

function request(extra: Record<string, unknown>) {
  return new Request('http://localhost/api/conversations/start-whatsapp', { method: 'POST',
    body: JSON.stringify({ phone: '573003364305', template_id: 'template', template_name: 'cart', template_params: ['Juan'], ...extra }) });
}

describe('new chat template send', () => {
  it('sends a synced cart button using the supplied destination and stored language', async () => {
    const response = await POST(request({ template_language: 'en', template_button_links: { 0: 'https://shop.example/checkout/123' } }));
    expect(response.status).toBe(200);
    expect(mocks.short).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'workspace', contactId: 'contact', targetUrl: 'https://shop.example/checkout/123' });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ language: 'es', params: ['Juan'], buttonUrlParams: [{ index: 0, text: 'customer-token' }] }));
    expect(mocks.filters).toContainEqual(['message_templates', 'eq', 'workspace_id', 'workspace']);
    expect(mocks.filters).toContainEqual(['message_templates', 'eq', 'status', 'Approved']);
  });
  it('rejects missing button links before contacting Meta or creating a redirect', async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'inbox.templateLinkRequired' });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.short).not.toHaveBeenCalled();
  });
  it('rejects missing body variables before contacting Meta', async () => {
    const response = await POST(request({ template_params: [] }));
    expect(response.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('still sends templates with no dynamic buttons', async () => {
    mocks.template.buttons = [];
    expect((await POST(request({}))).status).toBe(200);
    expect(mocks.short).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ buttonUrlParams: [] }));
  });
});
