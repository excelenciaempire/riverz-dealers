/** Refresh DeUNA confirmation templates without recreating agents or flows. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const workspaceId = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { crearPlantilla } = await import('@/lib/templates/create');
  const { reconcileWorkspaceAutomationReadiness } = await import('@/lib/automations/activation');
  const { data: flows, error } = await db.from('automations')
    .select('id,user_id').eq('workspace_id', workspaceId)
    .eq('name', 'DeUNA Shop · Confirmación contraentrega').is('deleted_at', null);
  if (error) throw error;
  if (flows?.length !== 1) throw new Error('Expected one DeUNA confirmation flow');
  const flow = flows[0];
  const confirmationRule = 'PROTOCOLO DE BOTONES: CONFIRMAR significa que el cliente valida los datos del resumen, no un cambio de estado logístico. Responde: "Gracias por confirmar que los datos son correctos." No digas "pedido confirmado", "se despachará" ni "llegará en los próximos días" sin consultar y verificar ese estado. No crees otro pedido. CORREGIR: pregunta qué dato necesita cambiar; no afirmes haberlo cambiado hasta una operación exitosa y recuerda que Dropi requiere revisión humana. Nunca prometas que una derivación ya ocurrió sin ejecutarla.';
  const { data: agents, error: agentError } = await db.from('ai_agents').select('id,persona').eq('workspace_id', workspaceId);
  if (agentError) throw agentError;
  for (const agent of agents ?? []) {
    if ((agent.persona ?? '').includes(confirmationRule)) continue;
    const { error: updateError } = await db.from('ai_agents').update({ persona: `${agent.persona ?? ''}\n\n${confirmationRule}` }).eq('id', agent.id).eq('workspace_id', workspaceId);
    if (updateError) throw updateError;
  }
  const definitions = [
    {
      old: 'deuna_confirmacion_contraentrega', name: 'deuna_confirmacion_datos_v2',
      body: 'Hola, {{1}}. Recibimos tu pedido {{2}} en DeUNA Shop.\n\nProductos: {{3}}\nTotal contraentrega: {{4}} COP\nDirección: {{5}}\nTeléfono: {{6}}\n\nRevisa estos datos. Pulsa CONFIRMAR si son correctos o CORREGIR para indicarnos el cambio. Si falta algún dato, pulsa CORREGIR.',
      fields: ['recipient_name', 'order_number', 'order_items', 'total_price', 'delivery_address', 'delivery_phone'],
      samples: ['Ana Pérez', '1001', '1 × Pelota saltarina LED (Rana Verde)', '110000', 'Calle 10 # 20-30, Apto 2, Cali, Valle del Cauca', '+573000000000'],
    },
    {
      old: 'deuna_recordatorio_confirmacion', name: 'deuna_recordatorio_datos_v2',
      body: 'DeUNA Shop: ¿los datos de tu pedido {{1}} son correctos?\n\nRevisa el resumen que te enviamos. Pulsa CONFIRMAR o CORREGIR para que podamos ayudarte.',
      fields: ['order_number'], samples: ['1001'],
    },
    {
      old: 'deuna_ultimo_recordatorio', name: 'deuna_revision_datos_v2',
      body: 'DeUNA Shop: seguimos disponibles para revisar los datos de tu pedido {{1}}.\n\nPulsa CONFIRMAR si el resumen es correcto o CORREGIR si necesitas un cambio. Si deseas cancelarlo, escríbenos para revisar su estado.',
      fields: ['order_number'], samples: ['1001'],
    },
  ];
  const { data: steps, error: stepError } = await db.from('automation_steps').select('id,step_config').eq('automation_id', flow.id);
  if (stepError) throw stepError;
  for (const item of definitions) {
    const { data: existing, error: lookupError } = await db.from('message_templates')
      .select('id,status').eq('workspace_id', workspaceId).eq('name', item.name).eq('language', 'es').maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing || existing.status === 'Draft') {
      const result = await crearPlantilla(db, {
        workspaceId, userId: flow.user_id, nombre: item.name, idioma: 'es', categoria: 'UTILITY',
        headerType: 'none', bodyText: item.body,
        buttons: [{ type: 'QUICK_REPLY', text: 'CONFIRMAR' }, { type: 'QUICK_REPLY', text: 'CORREGIR' }],
        bodySamples: item.samples,
        variableFields: Object.fromEntries(item.fields.map((field, i) => [String(i + 1), field])),
        plantillaExistenteId: existing?.id, enviarAMeta: true,
      });
      if (!result.ok) throw new Error(result.mensaje ?? result.claveI18n);
      console.log(JSON.stringify({ template: item.name, status: result.estado }));
    }
    for (const step of steps ?? []) {
      if (![item.old, item.name].includes(step.step_config.template_name)) continue;
      const { error: updateError } = await db.from('automation_steps').update({ step_config: {
        ...step.step_config, template_name: item.name,
        variables: Object.fromEntries(item.fields.map((field, i) => [String(i + 1), `{{vars.${field}}}`])),
      } }).eq('id', step.id).eq('automation_id', flow.id);
      if (updateError) throw updateError;
    }
  }
  const state = await reconcileWorkspaceAutomationReadiness(db, workspaceId);
  console.log(JSON.stringify({ readiness: state.map(row => ({ id: row.id, state: row.state, blockers: row.issues.map(i => i.path) })) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
