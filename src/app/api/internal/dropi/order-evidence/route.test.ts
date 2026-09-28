import { beforeEach, describe, expect, it, vi } from 'vitest';
const { verify, rpc } = vi.hoisted(() => ({ verify: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/logistics/dropi-bridge-auth', () => ({ verifyDropiBridgeSignature: verify }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }));
import { POST } from './route';

const payload = () => ({ version: 1, shopify_order_id: '123456', observed_at: new Date().toISOString(),
  evidence: { account_id: '455408', shop_id: '404013', dropi_order_id: '123', status: 'PENDIENTE',
    tracking_number: null, incident_reason: null, total: '110000', product_cost: '50000',
    shipping_cost: '10000', wallet_net: null, currency: 'COP', buyer_history: {
      classification: 'safe', buyer_type: 'Frecuente', total: 20, delivered: 20, returned: 0,
      in_transit: 0, observed_at: new Date(Date.now() - 1000).toISOString(), source: 'dropi_fingerprint_v2',
    } } });
const request = (body: unknown) => new Request('https://example.com/api/internal/dropi/order-evidence',
  { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); verify.mockReturnValue(true); rpc.mockResolvedValue({ data: 'updated', error: null }); });
describe('signed Dropi snapshot receipt', () => {
  it('enriches only the server-bound workspace and shop', async () => {
    expect((await POST(request(payload()))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('record_dropi_order_evidence', expect.objectContaining({
      p_workspace_id: '36f81b96-41b9-4d29-b72e-11be3d3070a3', p_shop_domain: 'bs9mqe-na.myshopify.com',
    }));
  });
  it('rejects unsigned requests before storage', async () => {
    verify.mockReturnValue(false);
    expect((await POST(request(payload()))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects a different Dropi store even with a valid signature', async () => {
    const p = payload(); p.evidence.shop_id = '999';
    expect((await POST(request(p))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects stale risk data and malformed payloads', async () => {
    const p = payload(); p.evidence.buyer_history.observed_at = new Date(Date.now() - 3600000).toISOString();
    expect((await POST(request(p))).status).toBe(409);
    expect((await POST(request(null))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not acknowledge a missing canonical order', async () => {
    rpc.mockResolvedValue({ data: 'order_not_mirrored', error: null });
    expect((await POST(request(payload()))).status).toBe(409);
  });
  it('acknowledges a replay without any customer-facing side effects', async () => {
    rpc.mockResolvedValue({ data: 'stale_or_duplicate', error: null });
    expect(await (await POST(request(payload()))).json()).toEqual({ ok: true, result: 'stale_or_duplicate' });
  });
});
