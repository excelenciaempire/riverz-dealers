// Read-only by default. --initialize-wallets creates missing empty wallets;
// ON CONFLICT DO NOTHING preserves every existing balance and billing setting.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase environment is required.');
const db = createClient(url, key, { auth: { persistSession: false } });

async function all(table, columns, modify = q => q) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await modify(db.from(table).select(columns)).range(offset, offset + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

const [accounts, flags, overrides, wallets, subscriptions] = await Promise.all([
  all('workspaces', 'id', q => q.is('deleted_at', null).order('id')),
  all('feature_flags', 'key,enabled', q => q.order('key')),
  all('workspace_feature_flags', 'workspace_id,key,enabled', q => q.order('workspace_id').order('key')),
  all('wallet_accounts', 'workspace_id', q => q.order('workspace_id')),
  all('workspace_subscriptions', 'workspace_id,estado', q => q.order('workspace_id')),
]);
const global = Object.fromEntries(flags.map(f => [f.key, f.enabled]));
const walletIds = new Set(wallets.map(w => w.workspace_id));
const subscriptionIds = new Set(subscriptions.map(s => s.workspace_id));
const missing = accounts.filter(a => !walletIds.has(a.id));
const disabled = accounts.filter(a => {
  const effective = { ...global, ...Object.fromEntries(overrides.filter(o => o.workspace_id === a.id).map(o => [o.key, o.enabled])) };
  return effective.riverz_2 === false || effective.operator_flota === false;
});

for (const [table, columns] of [
  ['operator_threads', 'id,workspace_id,created_by,title'],
  ['operator_messages', 'id,workspace_id,thread_id,content,prompt_tokens,completion_tokens'],
  ['operator_actions', 'id,workspace_id,thread_id,capability_key,args,status,artifact,result'],
  ['operator_runs', 'id,workspace_id,thread_id,estado,cancelar,texto,bloques,updated_at'],
  ['operator_plans', 'id,workspace_id,thread_id,status'],
  ['operator_plan_steps', 'id,workspace_id,plan_id,idx,agente,status'],
  ['operator_agent_usage', 'workspace_id,thread_id,agente,prompt_tokens,completion_tokens'],
  ['wallet_operaciones', 'id,workspace_id,concepto,estado,costo_centavos'],
]) {
  const { error } = await db.from(table).select(columns).limit(0);
  if (error) throw new Error(`Operator schema missing: ${table}: ${error.message}`);
}

console.log(JSON.stringify({ liveAccounts: accounts.length, operatorEnabled: accounts.length - disabled.length,
  missingWallets: missing.length, missingSubscriptions: accounts.filter(a => !subscriptionIds.has(a.id)).length,
  schema: 'verified' }));

if (process.argv.includes('--initialize-wallets') && missing.length) {
  for (let i = 0; i < missing.length; i += 500) {
    const { error } = await db.from('wallet_accounts').upsert(missing.slice(i, i + 500).map(a => ({ workspace_id: a.id })), {
      onConflict: 'workspace_id', ignoreDuplicates: true,
    });
    if (error) throw new Error(`Wallet initialization failed: ${error.message}`);
  }
  const verified = new Set((await all('wallet_accounts', 'workspace_id', q => q.order('workspace_id'))).map(w => w.workspace_id));
  if (accounts.some(a => !verified.has(a.id))) throw new Error('Wallet verification failed');
  console.log(JSON.stringify({ initializedWallets: missing.length, allLiveAccountsHaveWallets: true }));
}
if (disabled.length) process.exitCode = 1;
