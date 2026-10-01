import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { httpActionDefinition, type HttpActionBindings } from './http-action-contract';
const h = vi.hoisted(() => ({ visible: true }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
import { httpAssistantIdentityAllowed } from './http-assistant-identity';
const WS = '11111111-1111-4111-8111-111111111111', CONTACT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
let row: Record<string, unknown>, error: unknown, filters: Array<[string, unknown]>;
const read = vi.fn();
const bindings = (): HttpActionBindings => ({ contact_id: CONTACT, phone: row.phone as string | null, email: row.email as string | null });
function definition(source = 'phone', required = true) {
  return httpActionDefinition.parse({ name: 'Fixture', description: 'Fixture identity lookup', method: 'GET',
    url: 'https://fixture.test/status', credential_kind: 'none', parameters: [{ key: 'identity', source, type: 'string', required }], outputs: [] });
}
function db(): SupabaseClient {
  const q = { select: (fields: string) => { read(fields); return q; }, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    maybeSingle: async () => ({ data: row, error }) };
  return { from: (table: string) => { expect(table).toBe('contacts'); return q; } } as unknown as SupabaseClient;
}
const allowed = (source = 'phone', channel = 'whatsapp', required = true, snapshot = bindings()) =>
  httpAssistantIdentityAllowed(db(), WS, snapshot, channel, definition(source, required));
beforeEach(() => {
  h.visible = true; read.mockClear(); filters = []; error = null;
  row = { id: CONTACT, workspace_id: WS, phone: '+573128765490', email: 'buyer@example.test',
    phone_origen: 'canal', email_origen: 'tienda', union_bloqueada: false };
});
describe('assistant HTTP identity provenance', () => {
  it.each(['canal', 'pedido', 'tienda', 'pago', 'manual', null])('preserves existing backed/legacy eligibility: %s', async origin => {
    row.phone_origen = origin; row.email_origen = origin;
    expect(await allowed()).toBe(true); expect(await allowed('email')).toBe(true);
    expect(filters).toContainEqual(['workspace_id', WS]); expect(filters).toContainEqual(['id', CONTACT]);
  });
  it.each(['afirmado', 'unknown', 'CANAL', ''])('denies unbacked origins including optional present values: %s', async origin => {
    row.phone_origen = origin; row.email_origen = origin;
    expect(await allowed()).toBe(false); expect(await allowed('email')).toBe(false); expect(await allowed('phone', 'whatsapp', false)).toBe(false);
  });
  it.each(['phone', 'email'])('does not use visitor-provided %s for webchat external identity', async source => {
    expect(await allowed(source, 'webchat')).toBe(false);
  });
  it.each(['+00000000000', '+11111111111', '1234567890', '9876543210', '123', '  '])('rejects filler phone %s', async phone => {
    row.phone = phone; expect(await allowed()).toBe(false);
  });
  it.each(['info@example.test', ' NoReply@example.test ', 'ventas@example.test', 'support@example.test', 'not-email', ''])('rejects role or invalid email %s', async email => {
    row.email = email; expect(await allowed('email')).toBe(false);
  });
  it('honors manual separation without claiming external ownership', async () => {
    row.union_bloqueada = true; expect(await allowed()).toBe(false); expect(await allowed('email')).toBe(false);
    expect(await allowed('contact_id')).toBe(true);
  });
  it('keeps raw values untouched and accepts normal casing/formatting', async () => {
    row.phone = ' +57 (312) 876-5490 '; row.email = ' Buyer@Example.test ';
    const snapshot = bindings(); expect(await allowed('phone', 'whatsapp', true, snapshot)).toBe(true);
    expect(await allowed('email', 'gmail', true, snapshot)).toBe(true);
    expect(snapshot.phone).toBe(' +57 (312) 876-5490 '); expect(snapshot.email).toBe(' Buyer@Example.test ');
  });
  it('omits absent optional bindings but rejects absent required identity', async () => {
    row.phone = null; expect(await allowed()).toBe(false); expect(await allowed('phone', 'whatsapp', false)).toBe(true);
    expect(await allowed('phone', 'webchat', false)).toBe(true);
  });
  it.each(['workspace', 'contact', 'snapshot', 'missing-origin', 'missing-block', 'error'])('fails closed on %s mismatch', async mode => {
    const snapshot = bindings();
    if (mode === 'workspace') row.workspace_id = OTHER;
    if (mode === 'contact') row.id = OTHER;
    if (mode === 'snapshot') row.email = 'changed@example.test';
    if (mode === 'missing-origin') delete row.phone_origen;
    if (mode === 'missing-block') delete row.union_bloqueada;
    if (mode === 'error') error = { message: 'PRIVATE_ERROR' };
    expect(await allowed('phone', 'whatsapp', true, snapshot)).toBe(false);
  });
  it('does not read identity for ID-only actions and stays gated outside comparison', async () => {
    expect(await allowed('contact_id', 'webchat')).toBe(true); expect(read).not.toHaveBeenCalled();
    h.visible = false; expect(await allowed('contact_id')).toBe(false); expect(await allowed()).toBe(false); expect(read).not.toHaveBeenCalled();
  });
});
