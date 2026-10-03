import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEALER_TOOLS, dealerToolset, runDealerTool } from './agent-tools';
import { isDealerDeployment } from './config';
import { DealerError } from './validation';
import { demoData } from './demo';
vi.mock('./server', () => ({
  checkDb: (e: { message?: string } | null) => {
    if (e) throw new DealerError('failed');
  },
}));
function database({
  optedOut = false,
  missingContact = false,
  prior = true,
} = {}) {
  const d = demoData();
  const ops: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    let write = false,
      list = false;
    const q: Record<string, unknown> = {};
    const result = () => ({
      data:
        table === 'dealer_settings' ? {settings:{appointments:{weekdays:[0,1,2,3,4,5,6],start_hour:0,end_hour:24,notice_hours:0}},version:1} : table === 'contacts'
          ? missingContact
            ? null
            : { id: d.contacts[0].id, opted_out: optedOut }
          : table === 'dealer_opportunities'
            ? prior
              ? d.opportunities[0]
              : null
            : table === 'dealer_vehicles'
              ? list
                ? [d.vehicles[0]]
                : d.vehicles[0]
              : table === 'dealer_interests'
                ? []
                : table === 'workspaces'
                  ? { owner_id: d.seller_id }
                  : write
                    ? { id: 'appointment', status: 'requested' }
                    : null,
      error: null,
    });
    for (const method of [
      'select',
      'eq',
      'not',
      'in',
      'or',
      'order',
      'limit',
      'lte',
    ])
      q[method] = (...args: unknown[]) => {
        if (method === 'limit') list = true;
        ops.push({ table, method, args });
        return q;
      };
    q.insert = (...args: unknown[]) => {
      write = true;
      ops.push({ table, method: 'insert', args });
      return q;
    };
    q.maybeSingle = q.single = async () => result();
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve);
    return q;
  });
  const rpc = vi.fn(async () => ({ data: 'saved-opportunity', error: null }));
  return { db: { from, rpc } as unknown as SupabaseClient, from, rpc, ops, d };
}
describe('dealer conversation tools', () => {
  it('lets the simulator search real inventory without a stored buyer and never write', async () => {
    const f = database({ missingContact: true });
    const ctx = {
      db: f.db,
      workspaceId: 'fixed-workspace',
      contactId: '',
      simulacion: true,
    };
    const result = JSON.parse(
      await runDealerTool('dealer_search_vehicles', {}, ctx)
    );
    expect(result.ok).toBe(true);
    expect(f.from).not.toHaveBeenCalledWith('contacts');
    expect(
      JSON.parse(
        await runDealerTool('dealer_save_buyer', { preferences: 'SUV' }, ctx)
      ).simulated
    ).toBe(true);
    expect(
      JSON.parse(
        await runDealerTool(
          'dealer_request_appointment',
          { customer_agreed: false },
          ctx
        )
      ).ok
    ).toBe(false);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.ops.some((o) => o.method === 'insert')).toBe(false);
  });
  it('defaults this fork to dealers and allows explicit legacy regression mode', () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers');
    expect(isDealerDeployment()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'ecommerce');
    expect(isDealerDeployment()).toBe(false);
    vi.unstubAllEnvs();
  });
  it('removes checkout, orders and account operations from the customer toolset', () => {
    const old = [
      'create_order',
      'create_checkout',
      'buscar_producto',
      'lanzar_campana',
      'ver_contacto',
    ].map(
      (name) =>
        ({
          name,
          description: '',
          input_schema: { type: 'object' },
        }) as Anthropic.Tool
    );
    expect(
      dealerToolset(old, true).map((t) => ('name' in t ? t.name : ''))
    ).toEqual(['ver_contacto', ...DEALER_TOOLS.map((t) => t.name)]);
    expect(dealerToolset(old, false)).toHaveLength(1);
  });
  it('requires known currency before filtering by a budget', async () => {
    const f = database();
    const result = JSON.parse(
      await runDealerTool(
        'dealer_search_vehicles',
        { max_price: 20000 },
        {
          db: f.db,
          workspaceId: f.d.vehicles[0].workspace_id,
          contactId: f.d.contacts[0].id,
        }
      )
    );
    expect(result).toEqual({ ok: false, error: 'invalid' });
    for (const prior of [true, false]) {
      const buyer = database({ prior });
      expect(
        JSON.parse(
          await runDealerTool(
            'dealer_save_buyer',
            { budget: 20000 },
            {
              db: buyer.db,
              workspaceId: buyer.d.vehicles[0].workspace_id,
              contactId: buyer.d.contacts[0].id,
            }
          )
        )
      ).toEqual({ ok: false, error: 'invalid' });
      expect(buyer.rpc).not.toHaveBeenCalled();
    }
  });
  it('searches only current available inventory inside the fixed workspace', async () => {
    const f = database();
    await runDealerTool(
      'dealer_search_vehicles',
      { query: 'Toyota Camry', max_price: 25000, currency: 'USD' },
      { db: f.db, workspaceId: 'fixed-workspace', contactId: 'fixed-contact' }
    );
    expect(f.ops).toContainEqual({
      table: 'dealer_vehicles',
      method: 'eq',
      args: ['workspace_id', 'fixed-workspace'],
    });
    expect(f.ops).toContainEqual({
      table: 'dealer_vehicles',
      method: 'eq',
      args: ['status', 'available'],
    });
    expect(f.ops.filter((o) => o.method === 'or')).toHaveLength(3);
    expect(f.ops).toContainEqual({
      table: 'dealer_vehicles',
      method: 'or',
      args: ['price.lte.25000,price.is.null'],
    });
    expect(f.ops).toContainEqual({
      table: 'dealer_vehicles',
      method: 'order',
      args: ['price', { ascending: true, nullsFirst: false }],
    });
  });
  it('anchors buyer writes to the actual contact and preserves seller stage and follow-up', async () => {
    const f = database();
    const actual = f.d.contacts[0].id;
    const result = JSON.parse(
      await runDealerTool(
        'dealer_save_buyer',
        {
          preferences: 'SUV',
          contact_id: 'attacker',
          workspace_id: 'attacker',
          stage: 'won',
          follow_up_paused: true,
        },
        {
          db: f.db,
          workspaceId: f.d.vehicles[0].workspace_id,
          contactId: actual,
        }
      )
    );
    expect(result.ok).toBe(true);
    const call = (
      f.rpc.mock.calls as unknown as [
        string,
        { p_data: Record<string, unknown>; p_workspace: string },
      ][]
    )[0];
    expect(call[1].p_data).toMatchObject({
      contact_id: actual,
      stage: 'qualified',
      follow_up_paused: false,
      preferences: 'SUV',
    });
  });
  it('never writes from the assistant simulator', async () => {
    const f = database();
    const result = JSON.parse(
      await runDealerTool(
        'dealer_save_buyer',
        { preferences: 'SUV' },
        {
          db: f.db,
          workspaceId: f.d.vehicles[0].workspace_id,
          contactId: f.d.contacts[0].id,
          simulacion: true,
        }
      )
    );
    expect(result.simulated).toBe(true);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.ops.some((o) => o.method === 'insert')).toBe(false);
  });
  it('blocks opted-out buyers and foreign contact IDs', async () => {
    for (const [config, error] of [
      [{ optedOut: true }, 'closed'],
      [{ missingContact: true }, 'reference'],
    ] as const) {
      const f = database(config);
      const result = JSON.parse(
        await runDealerTool(
          'dealer_save_buyer',
          {},
          {
            db: f.db,
            workspaceId: f.d.vehicles[0].workspace_id,
            contactId: f.d.contacts[0].id,
          }
        )
      );
      expect(result).toEqual({ ok: false, error });
      expect(f.rpc).not.toHaveBeenCalled();
    }
  });
  it('creates only requested appointments for the real buyer with explicit agreement', async () => {
    const f = database();
    const a = f.d.appointments[0];
    const result = JSON.parse(
      await runDealerTool(
        'dealer_request_appointment',
        {
          ...a,
          vehicle_id: f.d.vehicles[0].id,
          opportunity_id: 'attacker',
          status: 'confirmed',
          customer_agreed: true,
        },
        {
          db: f.db,
          workspaceId: f.d.vehicles[0].workspace_id,
          contactId: f.d.contacts[0].id,
        }
      )
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'requested',
      seller_confirmation_required: true,
    });
    const insert = f.ops.find((o) => o.method === 'insert');
    expect(insert?.args[0]).toMatchObject({
      opportunity_id: f.d.opportunities[0].id,
      status: 'requested',
      seller_id: f.d.seller_id,
    });
    const rejected = JSON.parse(
      await runDealerTool(
        'dealer_request_appointment',
        { ...a, customer_agreed: false },
        {
          db: f.db,
          workspaceId: f.d.vehicles[0].workspace_id,
          contactId: f.d.contacts[0].id,
        }
      )
    );
    expect(rejected.ok).toBe(false);
  });
});
