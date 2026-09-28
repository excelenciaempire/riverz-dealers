/** Adds the call tail in place; never deletes steps, resets waits or dials. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { DEUNA_CALL_CONTEXT, DEUNA_VOICE_OBJECTIVE, DEUNA_VOICE_PROMPT } from './deuna-confirmation-voice';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const workspaceId = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const automationId = 'f29f3d74-f10f-42a5-946a-15b254a70106';
const name = 'DeUNA Shop · Confirmación por llamada';

async function main() {
  const { validateStepsForActivation } = await import('../src/lib/automations/validate');
  const flow = await db.from('automations').select('id,user_id,trigger_config,is_active')
    .eq('id', automationId).eq('workspace_id', workspaceId).single();
  if (flow.error) throw flow.error;
  if (flow.data.trigger_config?.stop_on_inbound !== true) throw new Error('Inbound cancellation must stay enabled');
  const existing = await db.from('ai_agents').select('id').eq('workspace_id', workspaceId)
    .eq('name', name).is('deleted_at', null).maybeSingle();
  if (existing.error) throw existing.error;
  const model = await db.from('voice_model_config').select('tts_default_voice_id').eq('id', 1).single();
  if (model.error) throw model.error;
  const agent = {
    workspace_id: workspaceId, name, created_by: flow.data.user_id, updated_by: flow.data.user_id,
    is_active: true, scope: 'channels', assigned_only: true, language: 'es', tone: 'friendly',
    persona: 'Eres Laura, asistente virtual de DeUNA Shop para revisar datos de pedidos existentes por teléfono. Español neutro de Colombia, una pregunta a la vez, sin presión. Tu procedimiento completo está en las instrucciones de llamada.',
    knowledge: 'DeUNA Shop vende en Colombia y el pedido se paga contraentrega. Shopify contiene pedidos y productos; Dropi requiere revisión logística humana. Confirmar datos no crea, modifica, despacha ni cancela pedidos. Nunca prometas cambios ni fechas sin verificar.',
    provider: 'anthropic', model: 'claude-sonnet-5-5', context_messages: 30,
    product_scope: 'all', followup_enabled: false, puede_crear_pedidos: false,
    permissions: { crear_pedidos: false, editar_pedido: false, crear_checkout: false, registrar_pago: false, escalar_llamada: false, enviar_proactivo: false },
    tools: { buscar_producto: 'auto', ver_producto: 'auto', lookup_order: 'auto', ver_contacto: 'auto', no_se_la_respuesta: 'auto', etiquetar_contacto: 'auto', gestionar_recompra: 'off', crear_pedido: 'off', crear_checkout: 'off', crear_link_de_pago: 'off', editar_pedido: 'off', cancelar_pedido: 'off', reembolsar: 'off', abrir_devolucion: 'off', registrar_pago: 'off', ofrecer_descuento: 'off', escalar_llamada: 'off', enviar_proactivo: 'off', buscar_en_internet: 'off', cerrar_conversacion: 'off' },
    voice_enabled: true, voice_id: model.data.tts_default_voice_id,
    voice_greeting: 'Hola, soy Laura, la asistente virtual de DeUNA Shop.',
    voice_system_prompt: DEUNA_VOICE_PROMPT,
    voice_objectives: { manual: { enabled: true, objective: DEUNA_VOICE_OBJECTIVE } },
    voice_calling_hours: { start: '06:00', end: '01:00', days: [1, 2, 3, 4, 5, 6, 7] },
    voice_max_call_seconds: 300, voice_max_retries: 0, voice_retry_delay_minutes: 180,
    voice_ai_decides: false, voice_accepts_inbound: false, voice_transfer_number: null,
    voice_recording_enabled: true, voice_recording_disclosure: true,
    voice_max_concurrent_calls: 1, voice_max_campaign_concurrent: 1,
  };
  const saved = existing.data
    ? await db.from('ai_agents').update(agent).eq('id', existing.data.id).eq('workspace_id', workspaceId).select('id').single()
    : await db.from('ai_agents').insert(agent).select('id').single();
  if (saved.error) throw saved.error;
  const agentId = saved.data.id;
  const channels = await db.from('ai_agent_channels').select('agent_id').eq('agent_id', agentId).eq('channel', 'voice');
  if (channels.error) throw channels.error;
  if (!channels.data.length) {
    const added = await db.from('ai_agent_channels').insert({ agent_id: agentId, channel: 'voice' });
    if (added.error) throw added.error;
  }
  const current = await db.from('automation_steps').select('*').eq('automation_id', automationId)
    .is('parent_step_id', null).order('position');
  if (current.error) throw current.error;
  const expected = ['send_template', 'wait', 'send_template', 'wait', 'send_template'];
  if (!expected.every((type, i) => current.data[i]?.position === i && current.data[i]?.step_type === type)) {
    throw new Error('Existing confirmation sequence changed; refusing to replace it');
  }
  const tail = [
    { position: 5, step_type: 'wait', step_config: { amount: 3, unit: 'hours' } },
    { position: 6, step_type: 'set_context', step_config: { values: DEUNA_CALL_CONTEXT } },
    { position: 7, step_type: 'voice_call', step_config: { agent_id: agentId, scenario: 'custom', objective_override: DEUNA_VOICE_OBJECTIVE, max_attempts: 1, wait_for_result: true } },
  ];
  const issues = validateStepsForActivation(tail);
  if (issues.length) throw new Error(JSON.stringify(issues));
  const extra = current.data.filter(s => s.position >= 5);
  if (extra.length) {
    // JSONB key ordering is not stable: compare canonical sorted keys.
    const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    if (extra.length !== tail.length || extra.some((s, i) => s.position !== tail[i].position || s.step_type !== tail[i].step_type || canonical(s.step_config) !== canonical(tail[i].step_config))) throw new Error('Another tail already exists');
  } else {
    const added = await db.from('automation_steps').insert(tail.map(step => ({ ...step, automation_id: automationId, parent_step_id: null, branch: null })));
    if (added.error) throw added.error;
  }
  const connection = await db.from('channel_connections').select('id,status,config').eq('workspace_id', workspaceId).eq('channel', 'voice').maybeSingle();
  if (connection.error) throw connection.error;
  console.log(JSON.stringify({ agentId, automationId, appendedSteps: tail.length, messagingActive: flow.data.is_active, voiceLineConnected: !!connection.data?.config?.phone_number, recordingDisclosure: true, attempts: 1 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
