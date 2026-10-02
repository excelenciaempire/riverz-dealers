import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { DealerError } from '@/lib/dealers/validation';
import { demoData } from '@/lib/dealers/demo';
const h = vi.hoisted(() => ({
  context: vi.fn(),
  csrf: vi.fn(),
  read: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  single: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({ csrfGuard: h.csrf }));
vi.mock('@/lib/dealers/server', () => ({
  dealerContext: h.context,
  readDealerData: h.read,
  checkDb: (e: { message?: string } | null) => {
    if (e) throw new DealerError('failed', 500);
  },
  dealerFailure: async (e: unknown) =>
    NextResponse.json(
      { error: e instanceof DealerError ? e.code : 'failed' },
      { status: e instanceof DealerError ? e.status : 500 }
    ),
}));
import { GET, POST } from './route';
beforeEach(() => {
  vi.resetAllMocks();
  h.csrf.mockResolvedValue(null);
  const q = { eq: h.eq, select: vi.fn(() => q), single: h.single };
  h.eq.mockReturnValue(q);
  h.insert.mockReturnValue(q);
  h.update.mockReturnValue(q);
  h.from.mockReturnValue({ insert: h.insert, update: h.update });
  h.single.mockResolvedValue({ data: { id: 'saved' }, error: null });
  h.rpc.mockResolvedValue({ data: 'saved', error: null });
  h.context.mockResolvedValue({
    db: { from: h.from, rpc: h.rpc },
    workspaceId: 'fixed-workspace',
    userId: 'fixed-user',
  });
  h.read.mockResolvedValue(demoData());
});
describe('dealer API authorization', () => {
  it('requires a signed-in user for reads', async () => {
    h.context.mockRejectedValue(new DealerError('unauthorized', 401));
    expect((await GET(new Request('http://app/api/dealers'))).status).toBe(401);
    expect(h.read).not.toHaveBeenCalled();
  });
  it('rejects CSRF before resolving or writing account data', async () => {
    h.csrf.mockResolvedValue(
      NextResponse.json({ error: 'csrf_mismatch' }, { status: 403 })
    );
    expect(
      (await POST(new Request('http://app/api/dealers', { method: 'POST' })))
        .status
    ).toBe(403);
    expect(h.context).not.toHaveBeenCalled();
  });
  it('fixes workspace ID at the session even when payload includes another account', async () => {
    const res = await POST(
      new Request('http://app/api/dealers', {
        method: 'POST',
        body: JSON.stringify({
          entity: 'vehicle',
          workspace_id: 'attacker',
          data: { ...demoData().vehicles[0], workspace_id: 'attacker' },
        }),
      })
    );
    expect(res.status).toBe(201);
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: 'fixed-workspace' })
    );
  });
  it('scopes edits to both workspace and the resource ID', async () => {
    const v = demoData().vehicles[0];
    const res = await POST(
      new Request('http://app/api/dealers', {
        method: 'POST',
        body: JSON.stringify({ entity: 'vehicle', id: v.id, data: v }),
      })
    );
    expect(res.status).toBe(200);
    expect(h.eq).toHaveBeenCalledWith('workspace_id', 'fixed-workspace');
    expect(h.eq).toHaveBeenCalledWith('id', v.id);
  });
  it('uses a single atomic RPC to save buyer preferences and interests', async () => {
    const o = demoData().opportunities[0];
    const res = await POST(
      new Request('http://app/api/dealers', {
        method: 'POST',
        body: JSON.stringify({
          entity: 'opportunity',
          data: { ...o, vehicle_ids: [] },
        }),
      })
    );
    expect(res.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith(
      'dealer_save_opportunity',
      expect.objectContaining({ p_workspace: 'fixed-workspace', p_id: null })
    );
  });
  it('reschedules with validated dates while stripping immutable appointment identities', async () => {
    const a = demoData().appointments[0];
    const response = await POST(
      new Request('http://app/api/dealers', {
        method: 'POST',
        body: JSON.stringify({
          entity: 'appointment',
          id: a.id,
          data: { ...a, seller_id: 'attacker' },
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith({
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      location: a.location,
      kind: a.kind,
      status: a.status,
    });
    expect(h.eq).toHaveBeenCalledWith('workspace_id', 'fixed-workspace');
    expect(h.eq).toHaveBeenCalledWith('id', a.id);
  });
  it('does not report success for malformed JSON or failed writes', async () => {
    expect(
      (
        await POST(
          new Request('http://app/api/dealers', { method: 'POST', body: '{' })
        )
      ).status
    ).toBe(400);
    h.single.mockResolvedValue({
      data: null,
      error: { message: 'database down' },
    });
    expect(
      (
        await POST(
          new Request('http://app/api/dealers', {
            method: 'POST',
            body: JSON.stringify({
              entity: 'vehicle',
              data: demoData().vehicles[0],
            }),
          })
        )
      ).status
    ).toBe(500);
  });
});
