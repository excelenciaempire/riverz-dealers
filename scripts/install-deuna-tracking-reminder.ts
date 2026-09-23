/**
 * Publica y activa el recordatorio de tracking de DeUNA Shop.
 *
 * Es idempotente y no reproduce pedidos anteriores. El flujo queda:
 * tracking enviado -> espera 48 h -> recordatorio. El motor vuelve a consultar
 * Shopify al despertar y omite pedidos entregados, cancelados o sin guía.
 *
 * Run: npx tsx scripts/install-deuna-tracking-reminder.ts
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  DEUNA_TRACKING_REMINDER_DELAY_HOURS,
  DEUNA_TRACKING_REMINDER_TEMPLATE,
} from '../src/lib/automations/deuna-tracking-reminder';

const WORKSPACE_ID = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const AUTOMATION_ID = '7aebb961-1207-4ad2-be03-11580e1de813';
const TRACKING_TEMPLATE = 'deuna_despachado_producto_v2';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type RemoteTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Array<{ type: string; text?: string }>;
};

async function remoteTemplateStatus(
  wabaId: string,
  accessToken: string,
  withProof: (url: string, token: string) => string,
) {
  const name = DEUNA_TRACKING_REMINDER_TEMPLATE.name;
  const url = withProof(
    `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${name}&fields=id,name,language,status,category,components&limit=100`,
    accessToken,
  );
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Meta template lookup failed (${response.status})`);
  const body = (await response.json()) as { data?: RemoteTemplate[] };
  return body.data?.find(
    (item) =>
      item.name === name &&
      item.language === DEUNA_TRACKING_REMINDER_TEMPLATE.language,
  ) ?? null;
}

async function main() {
  // These modules read ENCRYPTION_KEY during import, after .env.local has
  // already been loaded above.
  const [{ reconcileWorkspaceAutomationReadiness }, { withAppsecretProof }, templates] =
    await Promise.all([
      import('../src/lib/automations/activation'),
      import('../src/lib/channels/meta-graph'),
      import('../src/lib/templates/create'),
    ]);
  const { crearPlantilla, resolverWabaYToken } = templates;
  const flow = await db
    .from('automations')
    .select('id,user_id,name,is_active,activation_state')
    .eq('id', AUTOMATION_ID)
    .eq('workspace_id', WORKSPACE_ID)
    .is('deleted_at', null)
    .single();
  if (flow.error) throw flow.error;

  const definition = DEUNA_TRACKING_REMINDER_TEMPLATE;
  const local = await db
    .from('message_templates')
    .select('id,body_text,status')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('name', definition.name)
    .eq('language', definition.language)
    .maybeSingle();
  if (local.error) throw local.error;
  if (local.data && local.data.body_text !== definition.body) {
    throw new Error('Existing tracking reminder copy does not match the reviewed definition');
  }

  if (!local.data || local.data.status === 'Draft') {
    const created = await crearPlantilla(db, {
      workspaceId: WORKSPACE_ID,
      userId: flow.data.user_id,
      nombre: definition.name,
      idioma: definition.language,
      categoria: definition.category,
      headerType: 'none',
      bodyText: definition.body,
      bodySamples: [...definition.samples],
      variableFields: { ...definition.variableFields },
      plantillaExistenteId: local.data?.id,
      enviarAMeta: true,
    });
    if (!created.ok) throw new Error(created.mensaje ?? created.claveI18n);
  }

  const credentials = await resolverWabaYToken(
    db,
    WORKSPACE_ID,
    flow.data.user_id,
  );
  if (!credentials.wabaId || !credentials.accessToken) {
    throw new Error('WhatsApp account unavailable');
  }
  const remote = await remoteTemplateStatus(
    credentials.wabaId,
    credentials.accessToken,
    withAppsecretProof,
  );
  if (!remote) throw new Error('Template was submitted but Meta did not return it');
  const remoteBody = remote.components?.find((component) => component.type === 'BODY')?.text;
  if (remoteBody !== definition.body) throw new Error('Meta template copy mismatch');

  const status = remote.status === 'APPROVED'
    ? 'Approved'
    : remote.status === 'REJECTED'
      ? 'Rejected'
      : 'Pending';
  const saved = await db
    .from('message_templates')
    .update({
      status,
      meta_status: remote.status,
      category: remote.category === 'UTILITY' ? 'Utility' : 'Marketing',
      meta_template_id: remote.id,
    })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('name', definition.name)
    .eq('language', definition.language);
  if (saved.error) throw saved.error;

  if (status !== 'Approved' || remote.category !== 'UTILITY') {
    console.log(JSON.stringify({ template: definition.name, status, category: remote.category }));
    return;
  }

  const current = await db
    .from('automation_steps')
    .select('id,position,step_type,step_config,parent_step_id,branch')
    .eq('automation_id', AUTOMATION_ID)
    .is('parent_step_id', null)
    .order('position');
  if (current.error) throw current.error;
  const steps = current.data ?? [];
  const first = steps[0];
  if (
    !first ||
    first.position !== 0 ||
    first.step_type !== 'send_template' ||
    first.step_config?.template_name !== TRACKING_TEMPLATE
  ) {
    throw new Error('Tracking automation changed; inspect it before applying the reminder');
  }

  const waitStep = steps.find((step) => step.position === 1);
  const reminderStep = steps.find((step) => step.position === 2);
  const alreadyInstalled =
    steps.length === 3 &&
    waitStep?.step_type === 'wait' &&
    waitStep.step_config?.amount === DEUNA_TRACKING_REMINDER_DELAY_HOURS &&
    waitStep.step_config?.unit === 'hours' &&
    reminderStep?.step_type === 'send_template' &&
    reminderStep.step_config?.template_name === definition.name;

  if (!alreadyInstalled) {
    if (steps.length !== 1) {
      throw new Error('Tracking automation has unexpected steps; no changes were made');
    }
    const paused = await db
      .from('automations')
      .update({ is_active: false, activation_state: 'draft' })
      .eq('id', AUTOMATION_ID)
      .eq('workspace_id', WORKSPACE_ID);
    if (paused.error) throw paused.error;

    const inserted = await db.from('automation_steps').insert([
      {
        automation_id: AUTOMATION_ID,
        parent_step_id: null,
        branch: null,
        position: 1,
        step_type: 'wait',
        step_config: {
          amount: DEUNA_TRACKING_REMINDER_DELAY_HOURS,
          unit: 'hours',
        },
      },
      {
        automation_id: AUTOMATION_ID,
        parent_step_id: null,
        branch: null,
        position: 2,
        step_type: 'send_template',
        step_config: {
          template_name: definition.name,
          language: definition.language,
          variables: {
            '1': '{{vars.recipient_name}}',
            '2': '{{vars.tracking_number}}',
          },
        },
      },
    ]);
    if (inserted.error) throw inserted.error;
  }

  const description = await db
    .from('automations')
    .update({
      description: 'Envía la guía al prepararse el despacho y, 48 horas después, recuerda cómo recibir el pedido.',
    })
    .eq('id', AUTOMATION_ID)
    .eq('workspace_id', WORKSPACE_ID);
  if (description.error) throw description.error;

  const readiness = await reconcileWorkspaceAutomationReadiness(db, WORKSPACE_ID);
  const result = readiness.find((item) => item.id === AUTOMATION_ID);
  if (!result || result.state !== 'active') {
    throw new Error(`Automation was not activated: ${result?.issues.map((issue) => issue.path).join(', ') ?? 'missing'}`);
  }

  const verified = await db
    .from('automation_steps')
    .select('position,step_type,step_config')
    .eq('automation_id', AUTOMATION_ID)
    .is('parent_step_id', null)
    .order('position');
  if (verified.error || verified.data?.length !== 3) {
    throw new Error('Tracking reminder verification failed');
  }

  console.log(JSON.stringify({
    template: definition.name,
    status,
    category: remote.category,
    automation: result.state,
    steps: verified.data,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
