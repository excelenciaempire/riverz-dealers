/** Scoped, idempotent correction from the owner's 2026-10-02 voice note. Dry-run by default. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { REVITALY_DISCOUNT_KEY, REVITALY_DISCOUNT_POLICY, REVITALY_DISCOUNT_WORKSPACE as WS } from '../src/lib/ai/revitaly-discounts';

const MAIN_AGENT = 'b1e7a3c2-5d4f-4a8e-9c21-7f3d2a6b8e01';
const MAIN_PRODUCT = '1e31f1b5-eff3-426a-bf43-05bd4b6908ee';
const CLARIFICATION = 'Aclaración del dueño (02/10/2026): 10% únicamente por transferencia al alias de Mercado Pago; 5% con REVITALY5 sólo en la página web, para primera compra. Nunca se combinan, suman ni aplican sucesivamente. Para transferencia, parte del precio del pack antes del cupón web y aplica únicamente 10%; el envío se agrega sin descuento.';
const OFFER_CONDITION = 'El 5% es exclusivo de la web y no se combina con el 10% por transferencia al alias de Mercado Pago.';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const [guidance, agents, products] = await Promise.all([
    db.from('agent_guidance').select('*').eq('workspace_id', WS),
    db.from('ai_agents').select('id,knowledge,updated_at').eq('workspace_id', WS).eq('id', MAIN_AGENT),
    db.from('shopify_products').select('id,allowed_offers').eq('workspace_id', WS).eq('id', MAIN_PRODUCT),
  ]);
  for (const r of [guidance, agents, products]) if (r.error) throw r.error;
  if (agents.data?.length !== 1 || products.data?.length !== 1) throw new Error('Revitaly agent or product missing');
  const required = ['ofertas_pago_manual', 'f44cb9d0-7cce-4c25-8d89-df7b8acf38bf', '8cd33c43-b5d7-4351-99e3-ed78eb47a68f'];
  for (const key of required) if (!guidance.data?.some(r => r.clave === key || r.id === key)) throw new Error(`Required guidance missing: ${key}`);
  const patches = guidance.data!.filter(r => required.includes(r.clave) || required.includes(r.id))
    .filter(r => !r.hacer.includes(CLARIFICATION)).map(r => ({ row: r, hacer: `${r.hacer}\n\n${CLARIFICATION}` }));
  if (patches.some(p => p.hacer.length > 4000)) throw new Error('Updated guidance would be truncated');
  const agent = agents.data![0];
  const knowledge = (agent.knowledge ?? '').includes(CLARIFICATION) ? agent.knowledge : `${agent.knowledge ?? ''}\n${CLARIFICATION}`;
  const product = products.data![0];
  if (!Array.isArray(product.allowed_offers)) throw new Error('Missing offer array');
  const offers = product.allowed_offers.map((o: { conditions?: string }) => ({ ...o,
    conditions: (o.conditions ?? '').includes(OFFER_CONDITION) ? o.conditions : `${o.conditions ?? ''} ${OFFER_CONDITION}` }));
  const currentPolicy = guidance.data!.find(r => r.clave === REVITALY_DISCOUNT_KEY);
  const policyChanged = currentPolicy?.hacer !== REVITALY_DISCOUNT_POLICY || !currentPolicy?.activa;
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
    rules: patches.map(p => p.row.titulo), agentChanged: knowledge !== agent.knowledge,
    offersChanged: JSON.stringify(offers) !== JSON.stringify(product.allowed_offers), policyChanged }));
  if (!process.argv.includes('--apply')) return;
  mkdirSync('tmp', { recursive: true });
  const backup = `tmp/revitaly-payment-discounts-backup-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify({ guidance: guidance.data, agents: agents.data, products: products.data }, null, 2), 'utf8');
  console.log('Backup:', backup);
  async function update(table: string, row: { id: string; updated_at: string }, values: Record<string, unknown>) {
    const result = await db.from(table).update({ ...values, updated_at: new Date().toISOString() })
      .eq('workspace_id', WS).eq('id', row.id).eq('updated_at', row.updated_at).select('id');
    if (result.error || result.data?.length !== 1) throw result.error ?? new Error(`Concurrent update: ${table}/${row.id}`);
  }
  for (const p of patches) await update('agent_guidance', p.row, { hacer: p.hacer });
  if (knowledge !== agent.knowledge) await update('ai_agents', agent, { knowledge });
  if (JSON.stringify(offers) !== JSON.stringify(product.allowed_offers)) {
    const result = await db.from('shopify_products').update({ allowed_offers: offers }).eq('workspace_id', WS)
      .eq('id', product.id).eq('allowed_offers', JSON.stringify(product.allowed_offers)).select('id');
    if (result.error || result.data?.length !== 1) throw result.error ?? new Error('Concurrent product offer update');
  }
  if (policyChanged) {
    if (currentPolicy) await update('agent_guidance', currentPolicy, { hacer: REVITALY_DISCOUNT_POLICY, activa: true });
    else {
      const result = await db.from('agent_guidance').insert({ workspace_id: WS, agent_id: null,
        titulo: 'Descuentos según el medio de compra', cuando: 'Consulta descuentos, cupones, transferencia o calcula un total',
        hacer: REVITALY_DISCOUNT_POLICY, activa: true, orden: 1, origen: 'comercio', clave: REVITALY_DISCOUNT_KEY });
      if (result.error) throw result.error;
    }
  }
  const check = await db.from('agent_guidance').select('hacer,activa').eq('workspace_id', WS).eq('clave', REVITALY_DISCOUNT_KEY).single();
  if (check.error || check.data?.hacer !== REVITALY_DISCOUNT_POLICY || !check.data.activa) throw check.error ?? new Error('Policy readback failed');
  const [rulesCheck, agentCheck, productCheck] = await Promise.all([
    db.from('agent_guidance').select('id,hacer').eq('workspace_id', WS),
    db.from('ai_agents').select('knowledge').eq('workspace_id', WS).eq('id', MAIN_AGENT).single(),
    db.from('shopify_products').select('allowed_offers').eq('workspace_id', WS).eq('id', MAIN_PRODUCT).single(),
  ]);
  for (const r of [rulesCheck, agentCheck, productCheck]) if (r.error) throw r.error;
  if (patches.some(p => rulesCheck.data?.find(r => r.id === p.row.id)?.hacer !== p.hacer) ||
      agentCheck.data?.knowledge !== knowledge || JSON.stringify(productCheck.data?.allowed_offers) !== JSON.stringify(offers))
    throw new Error('Configuration readback mismatch');
  console.log('Verified Revitaly discount policy, guidance, agent knowledge and four unchanged pack prices.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
