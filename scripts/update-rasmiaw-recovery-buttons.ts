/**
 * Publica la v2 de las tres plantillas contraentrega de Rasmiaw y cambia el
 * flujo activo solamente cuando Meta ya aprobó las tres.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const workspaceId = 'b814e934-d832-4be9-bad4-79cca51c1e23';
const flowName = 'Rasmiaw · Nuevo pedido';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const definitions = [
  {
    oldName: 'rasmiaw_beneficio_contraentrega',
    name: 'rasmiaw_beneficio_contraentrega_v2',
    body: `🎈 ¡Tenemos un beneficio para ti!

Si cambias tu forma de pago y eliges pagar por Transferencia, Llave, Bold o Addi, recibirás un 5% de descuento en tu compra. 💛

Así podremos gestionar tu pedido más rápido, evitar retrasos y lograr que tu michi disfrute de su rascador lo antes posible. 😻

Responde “RECIBIR BENEFICIO” para cambiar el método de pago.

Responde “MANTENER CONTRAENTREGA” si prefieres conservar tu pago contra entrega.`,
  },
  {
    oldName: 'rasmiaw_recordatorio_contraentrega',
    name: 'rasmiaw_recordatorio_contraentrega_v2',
    body: `¿Te ayudamos a finalizar tu pedido? 😻

Aprovecha tu 5% de descuento y recibe tu Rasmiaw sin complicaciones. 💛

Responde “RECIBIR BENEFICIO” para cambiar tu método de pago y aplicar el descuento.

Responde “MANTENER CONTRAENTREGA” si prefieres conservar tu pago contra entrega.`,
  },
  {
    oldName: 'rasmiaw_ultima_oportunidad_contraentrega',
    name: 'rasmiaw_ultima_oportunidad_contraentrega_v2',
    body: `🚨 ¡Última oportunidad!

Subimos tu beneficio al 10% de descuento 🎉, este beneficio es por tiempo limitado.

Si quieres aprovecharlo, responde “RECIBIR BENEFICIO” y te ayudaremos a finalizar tu compra.

Si prefieres mantener tu pedido original, responde “MANTENER CONTRAENTREGA” para conservar tu pago contra entrega.

Válido durante las próximas 24 horas. 🏃`,
  },
] as const;

const buttons = [
  { type: 'QUICK_REPLY' as const, text: 'RECIBIR BENEFICIO' },
  { type: 'QUICK_REPLY' as const, text: 'MANTENER CONTRAENTREGA' },
];

function localStatus(raw: string): 'Pending' | 'Approved' | 'Rejected' {
  if (raw === 'APPROVED') return 'Approved';
  if (['REJECTED', 'PAUSED', 'DISABLED'].includes(raw)) return 'Rejected';
  return 'Pending';
}

async function main() {
  const { crearPlantilla, resolverWabaYToken } =
    await import('@/lib/templates/create');
  const { data: flows, error: flowError } = await db
    .from('automations')
    .select('id,user_id,is_active')
    .eq('workspace_id', workspaceId)
    .eq('name', flowName)
    .is('deleted_at', null);
  if (flowError) throw flowError;
  if (flows?.length !== 1)
    throw new Error('No se encontró el flujo de Rasmiaw.');
  const flow = flows[0];

  for (const definition of definitions) {
    const { data: existing, error } = await db
      .from('message_templates')
      .select('id,status')
      .eq('workspace_id', workspaceId)
      .eq('name', definition.name)
      .eq('language', 'es')
      .maybeSingle();
    if (error) throw error;
    if (!existing || String(existing.status).toLowerCase() === 'draft') {
      const result = await crearPlantilla(db, {
        workspaceId,
        userId: flow.user_id,
        nombre: definition.name,
        idioma: 'es',
        categoria: 'MARKETING',
        headerType: 'none',
        bodyText: definition.body,
        buttons,
        plantillaExistenteId: existing?.id,
        enviarAMeta: true,
      });
      if (!result.ok) {
        throw new Error(result.mensaje ?? result.claveI18n ?? 'Error de Meta');
      }
    }
  }

  const { data: rows, error: rowsError } = await db
    .from('message_templates')
    .select('id,user_id,name,meta_template_id')
    .eq('workspace_id', workspaceId)
    .in(
      'name',
      definitions.map((definition) => definition.name)
    );
  if (rowsError) throw rowsError;
  const { accessToken } = await resolverWabaYToken(
    db,
    workspaceId,
    rows?.[0]?.user_id ?? flow.user_id
  );
  if (!accessToken) throw new Error('WhatsApp no está conectado.');

  const statuses: Record<string, string> = {};
  for (const row of rows ?? []) {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${row.meta_template_id}?fields=status,rejected_reason`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) {
      throw new Error(`Meta no devolvió ${row.name}: ${response.status}`);
    }
    const remote = (await response.json()) as {
      status?: string;
      rejected_reason?: string | null;
    };
    const raw = String(remote.status ?? 'PENDING').toUpperCase();
    statuses[row.name] = raw;
    const { error } = await db
      .from('message_templates')
      .update({
        status: localStatus(raw),
        meta_status: raw,
        rejected_reason: remote.rejected_reason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) throw error;
  }

  const approved = definitions.every(
    (definition) => statuses[definition.name] === 'APPROVED'
  );
  if (!approved) {
    console.log(JSON.stringify({ switched: false, statuses }));
    return;
  }

  const { data: steps, error: stepsError } = await db
    .from('automation_steps')
    .select('id,step_config')
    .eq('automation_id', flow.id);
  if (stepsError) throw stepsError;
  for (const step of steps ?? []) {
    const definition = definitions.find((item) =>
      [item.oldName, item.name].includes(step.step_config.template_name)
    );
    if (!definition) continue;
    const { error } = await db
      .from('automation_steps')
      .update({
        step_config: { ...step.step_config, template_name: definition.name },
      })
      .eq('id', step.id)
      .eq('automation_id', flow.id);
    if (error) throw error;
  }

  console.log(
    JSON.stringify({ switched: true, active: flow.is_active, statuses })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
