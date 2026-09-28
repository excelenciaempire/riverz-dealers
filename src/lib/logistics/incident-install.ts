import { supabaseAdmin } from '@/lib/automations/admin-client';
import { armAutomation } from '@/lib/automations/activation';
import { crearPlantilla } from '@/lib/templates/create';
import {
  DELIVERY_INCIDENT_TEMPLATES,
  DELIVERY_INCIDENT_VARIABLE_FIELDS,
} from './incident-template';

const WORKSPACE_ID = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const USER_ID = '5cc2c562-5843-47c9-abea-4fd7ec9120c3';
const AUTOMATION_ID = '8e6b2239-f97e-4c74-80e4-3900e589dd74';
const SEND_STEP_ID = '2e1995fa-ea33-4f56-b730-b4f11de5b941';
const WAIT_STEP_ID = '80616e20-ec2f-4a44-b428-b0758e6bce45';

export async function installRiverzOfficialDeliveryIncidents() {
  const db = supabaseAdmin();
  const templateStatuses: Record<string, string> = {};

  for (const definition of DELIVERY_INCIDENT_TEMPLATES) {
    const { data: existing, error } = await db
      .from('message_templates')
      .select('id,status')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('name', definition.name)
      .eq('language', definition.language)
      .maybeSingle();
    if (error) throw error;

    let status = String(existing?.status ?? 'Draft');
    if (!existing || status === 'Draft') {
      const created = await crearPlantilla(db, {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        nombre: definition.name,
        idioma: definition.language,
        categoria: definition.category,
        bodyText: definition.body,
        bodySamples: [...definition.samples],
        buttons: [...definition.buttons],
        variableFields: { ...DELIVERY_INCIDENT_VARIABLE_FIELDS },
        plantillaExistenteId: existing?.id ?? null,
        enviarAMeta: true,
      });
      if (!created.ok) throw new Error(created.mensaje ?? created.claveI18n);
      status = created.estado;
    }
    templateStatuses[definition.language] = status;
  }

  const { data: agent, error: agentError } = await db
    .from('ai_agents')
    .select('id')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('name', 'Asesora de DeUNA Shop')
    .is('deleted_at', null)
    .maybeSingle();
  if (agentError) throw agentError;
  if (!agent) throw new Error('DeUNA Shop agent unavailable');

  const { data: existingAutomation, error: automationLookupError } = await db
    .from('automations')
    .select('id')
    .eq('id', AUTOMATION_ID)
    .maybeSingle();
  if (automationLookupError) throw automationLookupError;
  const automationDefinition = {
      id: AUTOMATION_ID,
      workspace_id: WORKSPACE_ID,
      user_id: USER_ID,
      name: 'DeUNA Shop · Novedad de entrega',
      description:
        'Avisa una novedad logística futura y entrega la respuesta al agente con el contexto del pedido.',
      trigger_type: 'shopify_order_incident_opened',
      trigger_config: {
        stop_on_inbound: true,
        handoff_ai_agent_id: agent.id,
      },
  };
  const automationWrite = existingAutomation
    ? await db
        .from('automations')
        .update(automationDefinition)
        .eq('id', AUTOMATION_ID)
    : await db.from('automations').insert({
        ...automationDefinition,
        is_active: false,
        activation_state: 'armed',
        activation_blockers: [],
        activation_requested_at: new Date().toISOString(),
      });
  if (automationWrite.error) throw automationWrite.error;

  const { error: stepsError } = await db.from('automation_steps').upsert([
      {
        id: SEND_STEP_ID,
        automation_id: AUTOMATION_ID,
        parent_step_id: null,
        branch: null,
        position: 0,
        step_type: 'send_template',
        step_config: {
          template_name: 'deuna_novedad_entrega_v1',
          language: 'es',
          variables: {
            '1': '{{vars.recipient_name}}',
            '2': '{{vars.order_items}}',
            '3': '{{vars.incident_reason}}',
            '4': '{{vars.tracking_number}}',
            '5': '{{vars.tracking_url}}',
          },
        },
      },
      {
        id: WAIT_STEP_ID,
        automation_id: AUTOMATION_ID,
        parent_step_id: null,
        branch: null,
        position: 1,
        step_type: 'wait',
        step_config: { amount: 72, unit: 'hours' },
      },
    ]);
  if (stepsError) throw stepsError;

  const guidance = {
    workspace_id: WORKSPACE_ID,
    agent_id: null,
    clave: 'deuna_delivery_incident',
    titulo: 'Novedades de entrega',
    cuando: 'Cuando la transportadora reporta una novedad de un pedido',
    hacer:
      'Usa el pedido, la causa, la guía y el rastreo guardados en automation_context. Retoma solo el dato que el cliente deba confirmar. No prometas una nueva visita ni digas que la novedad quedó solucionada hasta que Shopify muestre NOVEDAD SOLUCIONADA o el envío retome movimiento. Una corrección del cliente se registra y se deriva para aplicarla en Dropi; no afirmes que Dropi la aceptó sin evidencia.',
    activa: true,
    orden: 8,
    origen: 'comercio',
  };
  const { data: existingGuidance, error: guidanceLookupError } = await db
    .from('agent_guidance')
    .select('id')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('clave', guidance.clave)
    .maybeSingle();
  if (guidanceLookupError) throw guidanceLookupError;
  const guidanceResult = existingGuidance
    ? await db.from('agent_guidance').update(guidance).eq('id', existingGuidance.id)
    : await db.from('agent_guidance').insert(guidance);
  if (guidanceResult.error) throw guidanceResult.error;

  const activation = await armAutomation(db, AUTOMATION_ID, WORKSPACE_ID);
  return {
    templates: templateStatuses,
    automation: activation.state,
    issues: activation.issues,
  };
}
