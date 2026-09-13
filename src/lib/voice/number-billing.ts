import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelar } from '@/lib/wallet/operacion';
import { readVoiceConfig, writeVoiceConfig } from './voice-connection-store';
import { findNumberOrder, findOwnedNumber, orderNumber, releaseNumber, TelnyxApiError, type OrderedNumber } from './telnyx-numbers';
import { nextNumberRenewal, type NumberQuote } from './number-quote';

export interface NumberSubscription {
  id: string; workspace_id: string; phone_number: string; country: string;
  status: string; order_id: string | null; number_id: string | null;
  upfront_cents: number; monthly_cents: number; next_renewal_at: string | null;
  renewal_operation: string | null; created_at: string;
}
const initial = (s: NumberSubscription) => `number:${s.id}:initial`;
async function update(db: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { error } = await db.from('voice_number_subscriptions').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
async function settle(db: SupabaseClient, s: NumberSubscription, operation: string) {
  const { error } = await db.rpc('voice_number_settle', { p_workspace: s.workspace_id, p_operation: operation });
  if (error) throw error;
}
async function cancel(db: SupabaseClient, s: NumberSubscription, operation: string) {
  await cancelar({ db, workspaceId: s.workspace_id, concepto: 'numero_telefono' }, operation);
}
export async function currentNumberSubscription(db: SupabaseClient, workspace: string): Promise<NumberSubscription | null> {
  const { data, error } = await db.from('voice_number_subscriptions').select('*').eq('workspace_id', workspace).not('status', 'in', '(released,failed)').maybeSingle();
  if (error && ['42P01','PGRST205'].includes(error.code)) throw new Error('number_billing_unavailable');
  if (error) throw error;
  return data;
}
async function acceptOrder(db: SupabaseClient, s: NumberSubscription, order: OrderedNumber) {
  if (order.phone_number !== s.phone_number) throw new Error('number_order_mismatch');
  if (['failure', 'failed', 'cancelled'].includes(order.status)) {
    // Do not guess whether an asynchronous failure was refunded by the carrier.
    await update(db, s.id, { status: 'review', order_id: order.id });
    return;
  }
  await update(db, s.id, { order_id: order.id, status: 'pending', next_renewal_at: s.next_renewal_at ?? nextNumberRenewal(new Date(s.created_at)) });
  await settle(db, s, initial(s));
  if (order.status !== 'success') return;
  const owned = await findOwnedNumber(s.phone_number);
  if (!owned || owned.status !== 'active') return;
  const { id, config } = await readVoiceConfig(s.workspace_id);
  if (config.phone_number && config.phone_number !== s.phone_number) throw new Error('number_connection_conflict');
  // Store the number ID, never the order ID. Pending numbers cannot be used.
  await writeVoiceConfig(s.workspace_id, id, { ...config, phone_number: s.phone_number, country: s.country, telnyx_number_id: owned.id }, 'connected');
  await update(db, s.id, { status: 'active', number_id: owned.id });
}
export async function purchaseNumber(db: SupabaseClient, q: NumberQuote, user: string, group?: string) {
  const { data: id, error } = await db.rpc('voice_number_claim', {
    p_workspace: q.workspace, p_phone: q.phone, p_country: q.country, p_type: q.type,
    p_upfront: q.upfront, p_monthly: q.monthly, p_user: user,
  });
  if (error?.code === 'PGRST202') throw new Error('number_billing_unavailable');
  if (error) throw new Error(error.message);
  const s = await currentNumberSubscription(db, q.workspace);
  if (!s || s.id !== id) throw new Error('number_claim_missing');
  let order: OrderedNumber;
  try {
    order = await orderNumber({ phoneNumber: q.phone, requirementGroupId: group, customerReference: s.id, idempotencyKey: `voice-number-${s.id}` });
  } catch (error) {
    // Only an explicit rejection is safe to refund. Network/5xx uncertainty
    // stays held; the reconciler searches by this attempt's unique reference.
    if (error instanceof TelnyxApiError && [400,401,402,403,404,422,429].includes(error.status)) {
      await cancel(db, s, initial(s));
      await update(db, s.id, { status: 'failed' });
    }
    throw error;
  }
  await acceptOrder(db, s, order);
  return currentNumberSubscription(db, q.workspace);
}

async function releaseSubscription(db: SupabaseClient, s: NumberSubscription) {
  // Persist intent before the external mutation so a lost response is recoverable.
  await update(db, s.id, { status: 'releasing' });
  const owned = await findOwnedNumber(s.phone_number);
  if (owned) await releaseNumber(owned.id);
  const { id, config } = await readVoiceConfig(s.workspace_id);
  if (config.phone_number === s.phone_number) {
    await writeVoiceConfig(s.workspace_id, id, { ...config, phone_number: undefined, telnyx_number_id: undefined }, 'disconnected');
  }
  // The carrier charges at the month boundary even if cancellation happens
  // before our next cron tick. Do not refund a month already incurred.
  const renewalOperation = s.renewal_operation ?? (s.next_renewal_at ? `number:${s.id}:${s.next_renewal_at.slice(0,7)}` : null);
  if (renewalOperation) {
    // A crash may have happened between reserving and saving the operation ID.
    const receipt = await db.from('wallet_operaciones').select('estado').eq('id', renewalOperation).eq('workspace_id', s.workspace_id).maybeSingle();
    if (receipt.error) throw receipt.error;
    if (receipt.data?.estado === 'reservada') {
      if (s.next_renewal_at && Date.now() >= new Date(s.next_renewal_at).getTime()) await settle(db, s, renewalOperation);
      else await cancel(db, s, renewalOperation);
    }
  }
  await update(db, s.id, { status: 'released' });
}
export async function releaseBilledNumber(db: SupabaseClient, s: NumberSubscription) {
  const lock = await db.rpc('voice_number_lock', { p_id: s.id });
  if (lock.error) throw lock.error;
  if (!lock.data) throw new Error('number_busy');
  try {
    if (!['active','releasing'].includes(s.status)) throw new Error('number_pending');
    await releaseSubscription(db, s);
  } finally { await update(db, s.id, { lease_until: new Date().toISOString() }); }
}

/** New, explicitly opted-in numbers only. No retroactive charges on old DIDs. */
export async function reconcileNumbers(db: SupabaseClient, now = new Date()) {
  const { data, error } = await db.from('voice_number_subscriptions').select('*').not('status', 'in', '(released,failed)').lt('updated_at', new Date(now.getTime() - 180_000).toISOString()).order('updated_at').limit(100);
  if (error && ['42P01','PGRST205'].includes(error.code)) return { checked: 0, failures: ['number_billing_unavailable'] };
  if (error) throw error;
  const failures: string[] = [];
  for (let s of (data ?? []) as NumberSubscription[]) {
    const lock = await db.rpc('voice_number_lock', { p_id: s.id });
    if (lock.error || !lock.data) continue;
    try {
      if (s.status === 'review') { failures.push(s.id); continue; }
      if (s.status === 'releasing') { await releaseSubscription(db, s); continue; }
      if (['purchasing','pending'].includes(s.status)) {
        const order = await findNumberOrder(s.id);
        if (order) await acceptOrder(db, s, order);
        else failures.push(s.id); // Never retry a paid POST or refund uncertainty.
        const refreshed = await currentNumberSubscription(db, s.workspace_id);
        if (!refreshed || !['pending','active'].includes(refreshed.status)) { failures.push(s.id); continue; }
        s = refreshed;
        if (s.status === 'pending' && !(await findOwnedNumber(s.phone_number))) { failures.push(s.id); continue; }
      }
      if (!s.next_renewal_at) continue;
      const due = new Date(s.next_renewal_at).getTime();
      if (now.getTime() < due - 7 * 86400_000) continue;
      const operation = `number:${s.id}:${s.next_renewal_at.slice(0,7)}`;
      const held = await db.rpc('voice_number_reserve', { p_workspace: s.workspace_id, p_operation: operation, p_cents: s.monthly_cents, p_detail: { phone_number: s.phone_number, period: s.next_renewal_at.slice(0,7) } });
      if (held.error) throw held.error;
      if (!held.data) {
        // Consent states that funding is due 24h before the calendar month.
        // Releasing is necessary: just stopping calls does not stop MRC.
        if (now.getTime() >= due - 86400_000) await releaseSubscription(db, s);
        continue;
      }
      await update(db, s.id, { renewal_operation: operation });
      if (now.getTime() >= due) {
        await settle(db, s, operation);
        await update(db, s.id, { next_renewal_at: nextNumberRenewal(new Date(due)), renewal_operation: null });
      }
    } catch { failures.push(s.id); }
    finally { await update(db, s.id, { lease_until: new Date().toISOString() }); }
  }
  return { checked: data?.length ?? 0, failures };
}
