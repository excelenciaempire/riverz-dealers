/** Dry-run by default; reinforce the configured alias reply without changing payment terms. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { revitalyTransferReply } from '../src/lib/ai/revitaly-transfer';
import type { Regla } from '../src/lib/ai/guidance';

const WORKSPACE = '234604a9-909b-4e50-952b-acde4a85593a';
const AGENT = 'b1e7a3c2-5d4f-4a8e-9c21-7f3d2a6b8e01';
const REMINDER = 'En WhatsApp, Instagram, Messenger y chat web, si el cliente pide alias, CVU o datos para transferir, o elige transferencia, envía inmediatamente en ese mismo turno el titular, CVU y alias configurados abajo. Son datos confirmados del comercio: no digas que no los tienes, no prometas averiguarlos y no escales por compartirlos. No condiciones su envío a elegir pack, confirmar método, dirección ni crear un checkout. Compartir los datos no confirma ni acredita ningún pago. Para cotizar un total conserva las condiciones vigentes y pregunta sólo lo que falte. Esta instrucción no aplica a comentarios públicos, correo ni Mercado Libre.';

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Missing Supabase configuration');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const [rules, agent] = await Promise.all([
    db.from('agent_guidance').select('*').eq('workspace_id', WORKSPACE).eq('agent_id', AGENT).eq('clave', 'ofertas_pago_manual'),
    db.from('ai_agents').select('id,knowledge,updated_at').eq('workspace_id', WORKSPACE).eq('id', AGENT).single(),
  ]);
  if (rules.error || agent.error) throw rules.error ?? agent.error;
  if (rules.data.length !== 1 || !rules.data[0].activa) throw new Error('Expected one active transfer rule');
  const rule = rules.data[0] as Regla;
  const expected = revitalyTransferReply({ workspaceId: WORKSPACE, agentId: AGENT, channel: 'whatsapp',
    language: 'es', inbound: 'En un pago con transferencia vos me pasas alias.', rules: [rule] });
  if (!expected) throw new Error('Incomplete transfer configuration');
  const hacer = rule.hacer.startsWith(REMINDER) ? rule.hacer : `${REMINDER}\n\n${rule.hacer.replace('Env?o', 'Envío')}`;
  if (hacer.length > 4000) throw new Error('Transfer rule exceeds prompt limit');
  const knowledge = agent.data.knowledge === rule.hacer ? hacer : agent.data.knowledge;
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
    ruleChanged: hacer !== rule.hacer, knowledgeChanged: knowledge !== agent.data.knowledge, reply: expected }));
  if (!process.argv.includes('--apply')) return;
  mkdirSync('tmp', { recursive: true });
  const backup = `tmp/revitaly-transfer-backup-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify({ rule, agent: agent.data }, null, 2), 'utf8');
  if (hacer !== rule.hacer) {
    const result = await db.from('agent_guidance').update({ hacer, updated_at: new Date().toISOString() })
      .eq('workspace_id', WORKSPACE).eq('id', rule.id).eq('updated_at', rule.updated_at!).select('id');
    if (result.error || result.data?.length !== 1) throw result.error ?? new Error('Concurrent transfer rule update');
  }
  if (knowledge !== agent.data.knowledge) {
    const result = await db.from('ai_agents').update({ knowledge, updated_at: new Date().toISOString() })
      .eq('workspace_id', WORKSPACE).eq('id', AGENT).eq('updated_at', agent.data.updated_at).select('id');
    if (result.error || result.data?.length !== 1) throw result.error ?? new Error('Concurrent agent update');
  }
  const [readback, agentReadback] = await Promise.all([
    db.from('agent_guidance').select('*').eq('workspace_id', WORKSPACE).eq('id', rule.id).single(),
    db.from('ai_agents').select('knowledge').eq('workspace_id', WORKSPACE).eq('id', AGENT).single(),
  ]);
  if (readback.error || agentReadback.error) throw readback.error ?? agentReadback.error;
  if (readback.data.hacer !== hacer || agentReadback.data.knowledge !== knowledge) throw new Error('Transfer policy readback failed');
  const actual = revitalyTransferReply({ workspaceId: WORKSPACE, agentId: AGENT, channel: 'whatsapp',
    language: 'es', inbound: 'En un pago con transferencia vos me pasas alias.', rules: [readback.data] });
  if (actual !== expected) throw new Error('Transfer details changed during update');
  console.log(JSON.stringify({ verified: true, liveRevision: readback.data.live_revision, backup, reply: actual }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
