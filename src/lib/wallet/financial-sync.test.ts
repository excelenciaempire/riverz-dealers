import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const mock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/billing/stripe', () => ({ stripe: mock.client }));
import { payoutFundingBasis, syncFinancialCosts } from './financial-sync';
describe('manual payout cash allocation', () => {
  it('includes opening and unrelated cash rather than assigning it to a shop', () => {
    expect(payoutFundingBasis(10000, [940,500], 1000)).toBe(11440);
  });
  it('uses at least the real payout debit as denominator', () => {
    expect(payoutFundingBasis(-100,[940],2000)).toBe(2000);
  });
  it('rejects missing or invalid cash evidence', () => {
    expect(() => payoutFundingBasis(NaN,[1],100)).toThrow();
    expect(() => payoutFundingBasis(0,[-1],100)).toThrow();
  });
});

function fixture() {
  const at = 1790553600;
  const chargeTx = { id:'tx_charge', type:'charge', created:at+100, currency:'usd', net:950, amount:1000, fee:50, source:'ch_1' };
  const payoutTx = { id:'tx_payout', type:'payout', created:at+200, currency:'usd', net:-950, amount:-900, fee:50, source:'po_1' };
  const rows: Record<string, unknown[]> = {
    wallet_financial_config: [{ activated_at: new Date(at*1000).toISOString(), stripe_account:'acct_1', enabled:true }],
    wallet_financial_receipts: [],
    wallet_movimientos: [{ id:'m1',centavos:1000,detalle:{balanceTransaction:'tx_charge',paymentIntent:'pi_1'} }],
    workspace_subscriptions:[{modelo_cobro:'saldo',estado:'activa'}],
  };
  const rpc = vi.fn().mockResolvedValue({error:null});
  const db = { rpc, from(table:string) {
    let single=false;
    const q = { select:()=>q, eq:()=>q,gte:()=>q,order:()=>q,range:()=>q,
      single:()=>{single=true;return q;},maybeSingle:()=>{single=true;return q;},
      then: (resolve: (v:unknown)=>unknown) => Promise.resolve({data:single ? rows[table][0] : rows[table],error:null}).then(resolve) };
    return q;
  }} as unknown as SupabaseClient;
  const iterable = (items: unknown[]) => ({ async *[Symbol.asyncIterator]() { yield* items; } });
  const client = {
    accounts: {retrieveCurrent:vi.fn().mockResolvedValue({id:'acct_1',country:'US',default_currency:'usd'})},
    charges: {retrieve:vi.fn().mockResolvedValue({id:'ch_1',paid:true,disputed:false,amount_refunded:0,payment_intent:'pi_1',balance_transaction:'tx_charge'})},
    paymentIntents: {retrieve:vi.fn().mockResolvedValue({id:'pi_1',created:at+100,status:'succeeded',currency:'usd',amount_received:1000,metadata:{tipo:'recarga_billetera',workspace_id:'ws1'}})},
    payouts: {list:vi.fn((params:{created:{lt?:number}})=>params.created.lt ? Promise.resolve({data:[]}) : iterable([{id:'po_1',method:'instant',status:'paid',currency:'usd',created:at+200,balance_transaction:'tx_payout'}]))},
    balance: {retrieve:vi.fn().mockResolvedValue({available:[{currency:'usd',amount:0}],pending:[]})},
    balanceTransactions: {
      retrieve:vi.fn((id:string)=>Promise.resolve(id==='tx_charge' ? chargeTx : payoutTx)),
      list:vi.fn((params:{limit:number})=>params.limit===1 ? Promise.resolve({data:[payoutTx]}) : iterable([payoutTx,chargeTx])),
    },
  };
  mock.client.mockReturnValue(client);
  return {db,rpc,client,rows,chargeTx,payoutTx};
}
describe('Stripe read-only expense synchronization', () => {
  it('imports verified processing and the real instant fee without moving any money', async () => {
    const {db,rpc} = fixture();
    expect(await syncFinancialCosts(db)).toEqual({enabled:true,processing:1,payouts:1});
    expect(rpc.mock.calls.map(c=>c[1].p_fee)).toEqual([50,50]);
    expect(rpc.mock.calls[1][1].p_allocations).toMatchObject([{fundingId:'pi_1',workspaceId:'ws1',allocatedCents:50,basisCents:950}]);
  });
  it('skips already imported receipts and never imports from another account', async () => {
    const {db,rows,client,rpc} = fixture();
    rows.wallet_financial_receipts=[{id:'tx_charge'},{id:'tx_payout'}];
    expect(await syncFinancialCosts(db)).toEqual({enabled:true,processing:0,payouts:0});
    expect(rpc).not.toHaveBeenCalled();
    client.accounts.retrieveCurrent.mockResolvedValue({id:'wrong',country:'US',default_currency:'usd'});
    await expect(syncFinancialCosts(db)).rejects.toThrow('wallet_financial_stripe_account_mismatch');
  });
  it('excludes refunded top-ups from both types of future recovery', async () => {
    const {db,rpc,client} = fixture();
    client.charges.retrieve.mockResolvedValue({id:'ch_1',paid:true,disputed:false,amount_refunded:100,payment_intent:'pi_1',balance_transaction:'tx_charge'});
    await syncFinancialCosts(db);
    expect(rpc.mock.calls.every(c=>c[1].p_allocations.length===0)).toBe(true);
  });
  it('does not assign an instant fee when the cash snapshot changed mid-read', async () => {
    const {db,rpc,client} = fixture();
    client.balance.retrieve.mockResolvedValueOnce({available:[{currency:'usd',amount:1}],pending:[]});
    await expect(syncFinancialCosts(db)).rejects.toThrow('wallet_financial_cash_snapshot_changed');
    expect(rpc.mock.calls).toHaveLength(1);
  });
  it('includes ambiguous same-second money in the denominator, never in merchant shares', async () => {
    const {db,rpc,client,chargeTx,payoutTx} = fixture();
    client.balance.retrieve.mockResolvedValue({available:[{currency:'usd',amount:950}],pending:[]});
    client.balanceTransactions.list.mockImplementation(params => params.limit===1 ? Promise.resolve({data:[payoutTx]}) : ({
      async *[Symbol.asyncIterator]() {
        yield payoutTx; yield chargeTx;
        yield {...chargeTx,id:'tx_other',type:'adjustment',created:payoutTx.created};
      },
    }));
    await syncFinancialCosts(db);
    expect(rpc.mock.calls[1][1].p_allocations[0].allocatedCents).toBe(25);
  });
});
