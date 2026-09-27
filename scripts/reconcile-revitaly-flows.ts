/** Applies the owner's September 2026 Revitaly brief. Run once; template creation is idempotent. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pdfCopy } from './revitaly-pdf-copy';
import { createClient } from '@supabase/supabase-js';
import type { BuilderStepInput } from '@/lib/automations/steps-tree';
import type { EntradaCrearPlantilla } from '@/lib/templates/create';

const WS = '234604a9-909b-4e50-952b-acde4a85593a';
const AGENT = 'b1e7a3c2-5d4f-4a8e-9c21-7f3d2a6b8e01';
const OWNER = '9fcd3c4f-edbe-4f08-9887-dfca0c9142cb';
const PRODUCT = 'Revitaly™ – Recuperá un cabello más fuerte y abundante';
const STOP = '799bfcf8-717c-41cc-8166-7986f03b39d5';
const ids = {
  cart: '9ebc5a99-3ce1-40de-8ebe-285372a75152',
  pending: '9e2140d3-ddf8-4fec-9f6c-a95554afd65a',
  rejected: '33a646e9-148b-4e62-b0a8-91202721a715',
  retention: '950ba379-cb2f-4019-8c1e-3619ad7bcfe4',
};
const quick = (text: string) => ({ type: 'QUICK_REPLY' as const, text });
const link = (
  text: string,
  url_variable: 'abandoned_checkout' | 'order_status'
) => ({ type: 'URL' as const, text, url_variable });
const buy = [
  link('Terminar mi compra', 'abandoned_checkout'),
  quick('Necesito ayuda'),
];
const pay = [
  link('Completar mi pago', 'order_status'),
  quick('Necesito ayuda'),
];
const stop = quick('No más recordatorios');
export const templates: Array<
  Omit<EntradaCrearPlantilla, 'workspaceId' | 'userId'>
> = [];
function template(
  key: string,
  buttons: EntradaCrearPlantilla['buttons'],
  category = 'MARKETING'
) {
  const name = `revitaly_${key}_pdf_v5`;
  const bodyText =
    pdfCopy[key === 'pago_vencido_carrito' ? 'carrito_3_cupon' : key];
  if (!bodyText) throw new Error('Missing PDF copy: ' + key);
  templates.push({
    nombre: name,
    categoria: category,
    idioma: 'es',
    bodyText,
    buttons,
    bodySamples: ['Juan'],
    variableFields: { '1': 'recipient_first_name' },
  });
  return name;
}
const cart = [
  template('carrito_1', buy),
  template('carrito_2_dudas', buy),
  template('carrito_3_cupon', [
    link('Usar mi cupón', 'abandoned_checkout'),
    quick('Necesito ayuda'),
  ]),
  template('carrito_4_final', [
    link('Sí, lo quiero', 'abandoned_checkout'),
    quick('No, gracias'),
  ]),
];
const pending = [
  template('pendiente_1', pay),
  template('pendiente_2', [
    link('Completar mi pago', 'order_status'),
    quick('Transferencia 10% OFF'),
    quick('Pagar por Mercado Libre'),
  ]),
  template('pendiente_3', pay),
];
const rejected = [
  template('rechazado_1', [
    link('Reintentar pago', 'abandoned_checkout'),
    quick('Necesito ayuda'),
  ]),
  template('rechazado_2', [
    quick('Pagar por Mercado Libre'),
    quick('Transferencia 10% OFF'),
    quick('Necesito ayuda'),
  ]),
  template('rechazado_3', [quick('Sí, ayudame'), quick('No, gracias')]),
];
// Payment expiry enters the PDF's cart message 3, never the old rewritten fallback.
// A fresh product checkout avoids directing customers to an expired payment coupon.
const expired = template('pago_vencido_carrito', [
  {
    type: 'URL',
    text: 'Usar mi cupón',
    url: 'https://revitaly.store/discount/REVITALY5?redirect=/products/revitaly-shampoo-revitalizador-crecimiento',
  },
  quick('Necesito ayuda'),
]);
const care = [
  template('postventa_uso', [quick('Necesito ayuda'), stop], 'UTILITY'),
  template('postventa_constancia', [quick('Necesito ayuda'), stop], 'UTILITY'),
  template(
    'postventa_experiencia',
    [quick('Ya noto cambios'), quick('Necesito ayuda'), stop],
    'UTILITY'
  ),
];
const stock = template('recompra_cuanto_queda', [
  quick('Me queda poco'),
  quick('Tengo para rato'),
  stop,
]);
const offers: Record<number, string> = {};
for (const [bought, next] of [
  [1, 2],
  [2, 3],
  [3, 10],
  [10, 10],
]) {
  offers[bought] = template(`recompra_oferta_${bought}`, [
    quick(bought === 10 ? 'Quiero otras 10' : `Quiero ${next} botellas`),
    quick(
      bought === 10
        ? 'Otro pack'
        : bought === 1
          ? 'Solo 1 botella'
          : `Repetir ${bought} botellas`
    ),
    quick('Necesito ayuda'),
  ]);
}
const timely = template('recompra_pedir_a_tiempo', [
  quick('Pedir ahora'),
  quick('Necesito ayuda'),
  stop,
]);
const returnMsg = template('recompra_retomar', [
  quick('Quiero retomarlo'),
  quick('Te cuento'),
  stop,
]);

const s = (
  step_type: string,
  step_config: Record<string, unknown>
): BuilderStepInput => ({ id: randomUUID(), step_type, step_config });
const wait = (amount: number, unit = 'hours') => s('wait', { amount, unit });
const cond = (
  step_config: Record<string, unknown>,
  yes: BuilderStepInput[],
  no: BuilderStepInput[] = []
): BuilderStepInput => ({
  ...s('condition', step_config),
  branches: { yes, no },
});
const send = (name: string) =>
  s('send_template', {
    template_name: name,
    language: 'es',
    variables: {
      '1': '{{vars.recipient_first_name|vars.contact_first_name|vars.customer_name}}',
    },
    cooldown_hours: 0,
    ...([...pending, ...rejected].includes(name)
      ? { expires_after_hours: 24 }
      : {}),
  });
const guard = (suffix: BuilderStepInput[]) =>
  cond(
    { subject: 'tag_presence', operand: STOP },
    [],
    [
      cond(
        { subject: 'purchased', operand: 'since_trigger', value: 'true' },
        [],
        suffix
      ),
    ]
  );
function recovery(
  names: string[],
  waits: number[],
  paid = false,
  tail: BuilderStepInput[] = [],
  cartPriority = false
): BuilderStepInput[] {
  for (let i = names.length - 1; i >= 0; i--) {
    const continuation = [send(names[i]), ...tail];
    tail = [
      wait(waits[i], 'minutes'),
      cond(
        paid
          ? { subject: 'order_paid', value: 'false' }
          : { subject: 'purchased', operand: 'since_trigger', value: 'false' },
        cartPriority
          ? [
              cond(
                { subject: 'rejected_open', operand: '24h', value: 'false' },
                continuation
              ),
            ]
          : continuation
      ),
    ];
  }
  return tail;
}

export function buildTrees() {
  const cartTree = [
    cond(
      { subject: 'messaged', operand: '7d', value: 'false' },
      recovery(cart, [30, 1410, 1440, 1440], false, [], true)
    ),
  ];
  const pendingTree = [
    cond(
      {
        subject: 'context_var',
        operand: 'financial_status',
        op: 'eq',
        value: 'pending',
      },
      recovery(pending, [30, 150, 240], true, [
        s('wait', { amount: 17, unit: 'hours', from_trigger_hours: 24 }),
        cond({ subject: 'order_paid', value: 'false' }, [send(expired)]),
      ])
    ),
  ];
  const rejectedTree = recovery(rejected, [10, 50, 120], false, [
    s('wait', { amount: 21, unit: 'hours', from_trigger_hours: 24 }),
    cond({ subject: 'purchased', operand: 'since_trigger', value: 'false' }, [
      send(expired),
    ]),
  ]);
  let branches: BuilderStepInput[] = [];
  for (const [units, day] of [
    [10, 300],
    [3, 90],
    [2, 60],
    [1, 30],
  ]) {
    const question = guard([send(stock)]);
    const offer = guard([
      s('set_context', { values: { retention_stage: 'offer' } }),
      send(offers[units]),
      wait(7, 'days'),
      guard([send(timely), wait(10, 'days'), guard([send(returnMsg)])]),
    ]);
    question.branches!.no![0].branches!.no!.push(wait(7, 'days'), offer);
    const path = [
      wait(day - 14, 'days'),
      s('set_context', {
        values: {
          retention_stage: 'stock_check',
          retention_stock_deferrals: 0,
          retention_question_cursor: question.id,
          retention_offer_cursor: offer.id,
        },
      }),
      question,
    ];
    branches = [
      cond(
        {
          subject: 'context_var',
          operand: 'retention_units',
          op: 'eq',
          value: String(units),
        },
        path,
        branches
      ),
    ];
  }
  const retentionTree = [
    cond(
      {
        subject: 'context_var',
        operand: 'retention_product',
        op: 'eq',
        value: PRODUCT,
      },
      [
        wait(1, 'days'),
        guard([
          send(care[0]),
          wait(5, 'days'),
          guard([
            send(care[1]),
            wait(8, 'days'),
            guard([send(care[2]), ...branches]),
          ]),
        ]),
      ]
    ),
  ];
  return {
    cart: cartTree,
    pending: pendingTree,
    rejected: rejectedTree,
    retention: retentionTree,
  };
}

async function main() {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { crearPlantilla, resolverWabaYToken } =
    await import('@/lib/templates/create');
  const { replaceSteps, loadStepsTree } =
    await import('@/lib/automations/steps-tree');
  const { armAutomation } = await import('@/lib/automations/activation');
  const before = await db
    .from('automations')
    .select('*')
    .eq('workspace_id', WS)
    .is('deleted_at', null);
  if (before.error) throw before.error;
  const running = await db
    .from('automation_pending_executions')
    .select('id')
    .eq('workspace_id', WS)
    .in('automation_id', Object.values(ids))
    .in('status', ['pending', 'running']);
  if (running.error) throw running.error;
  if (running.data.length)
    throw new Error('Refusing to replace steps while customer runs exist');
  if (!existsSync('tmp/revitaly-before-pdf-v5.json')) {
    const trees: Record<string, BuilderStepInput[]> = {};
    for (const a of before.data) trees[a.id] = await loadStepsTree(a.id);
    const [agents, comments] = await Promise.all([
      db
        .from('ai_agents')
        .select('id,persona,scope,is_active,tools')
        .eq('workspace_id', WS),
      db.from('ig_proactive_settings').select('*').eq('workspace_id', WS),
    ]);
    writeFileSync(
      'tmp/revitaly-before-pdf-v5.json',
      JSON.stringify(
        {
          automations: before.data,
          trees,
          agents: agents.data,
          comments: comments.data,
        },
        null,
        2
      )
    );
  }
  // Save the whole reviewed set first. A Meta outage must not leave the board
  // linked to obsolete copy or discard the rest of the owner's messages.
  const toSubmit: typeof templates = [];
  for (const t of templates) {
    const existing = await db
      .from('message_templates')
      .select('id,meta_template_id')
      .eq('workspace_id', WS)
      .eq('name', t.nombre)
      .eq('language', 'es')
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.meta_template_id) continue;
    const result = await crearPlantilla(db, {
      ...t,
      workspaceId: WS,
      userId: OWNER,
      enviarAMeta: false,
    });
    if (!result.ok) throw new Error(t.nombre + ': ' + JSON.stringify(result));
    toSubmit.push(t);
    console.log(
      JSON.stringify({ template: t.nombre, meta: result.metaTemplateId })
    );
  }
  const trees = buildTrees();
  const descriptions = {
    cart: 'Cuatro contactos: 30 minutos, 24, 48 y 72 horas. Recordatorio, dudas, 5% y cierre con 10%.',
    pending:
      'Pago pendiente: 30 minutos, 3 y 7 horas. Pago directo, alternativas y vencimiento a las 24 horas.',
    rejected:
      'Pago rechazado: 10 minutos, 1 y 3 horas. Reintento, alternativas y ayuda de Natalia.',
    retention:
      'Desde la entrega: días 1, 6 y 14. Stock a los 30/60/90/300 días, oferta +7, pedir a tiempo +7 y retomar +10. Tengo para rato: repetir en 15 días, máximo dos veces.',
  };
  for (const key of Object.keys(ids) as Array<keyof typeof ids>) {
    const old = before.data.find((a) => a.id === ids[key]);
    if (!old) throw new Error('Missing scoped automation ' + key);
    const err = await replaceSteps(ids[key], trees[key]);
    if (err) throw new Error(err);
    const result = await db
      .from('automations')
      .update({
        description: descriptions[key],
        trigger_config: {
          ...old.trigger_config,
          reminder_hours: {
            start: 9,
            end: 22,
            timezone: 'America/Argentina/Buenos_Aires',
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', WS)
      .eq('id', ids[key]);
    if (result.error) throw result.error;
  }
  const comments = await db.from('ig_proactive_settings').upsert(
    {
      workspace_id: WS,
      comment_audience: 'all',
      comment_reply_mode: 'public_dm',
      comment_public_reply: true,
      comment_instagram: true,
      comment_facebook: true,
      auto_reply_comments: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' }
  );
  if (comments.error) throw comments.error;
  const agent = await db
    .from('ai_agents')
    .select('persona,tools')
    .eq('workspace_id', WS)
    .eq('id', AGENT)
    .single();
  if (agent.error) throw agent.error;
  const policy =
    '\n\nSeguimiento Revitaly (septiembre 2026): al responder «Me queda poco», el sistema adelanta la oferta. Con «Tengo para rato» vuelve a preguntar a los 15 días, máximo dos veces; no prometas otro plazo ni uses gestionar_recompra para sobrescribir esa programación. Si dice «ya pagué», explica que la acreditación puede tardar unas horas y deriva la verificación al equipo. Para transferencia se ofrece 10% OFF y se calcula sobre el pack elegido; nunca inventes Alias/CVU. Consulta los datos configurados y, si no existen, pasa al equipo. Para Mercado Libre busca la publicación de la cantidad elegida y usa su precio real. No prometas haber enviado un privado antes de que el envío haya ocurrido. El equipo valida pagos alternativos antes de cancelar el pedido pendiente.';
  if (!agent.data.persona.includes('Seguimiento Revitaly (septiembre 2026)')) {
    const r = await db
      .from('ai_agents')
      .update({
        persona: agent.data.persona + policy,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', WS)
      .eq('id', AGENT);
    if (r.error) throw r.error;
  }
  const tools = await db
    .from('ai_agents')
    .update({
      tools: { ...agent.data.tools, crear_checkout: 'auto' },
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', WS)
    .eq('id', AGENT);
  if (tools.error) throw tools.error;
  const { accessToken, wabaId } = await resolverWabaYToken(db, WS, OWNER);
  // Reconcile uncertain responses by name before retrying a creation.
  const submit = async (t: (typeof templates)[number]) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const check = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${encodeURIComponent(t.nombre)}&fields=id,name,status,components,language`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!check.ok) throw new Error('Meta lookup HTTP ' + check.status);
      const remote = (await check.json()).data?.find(
        (r: { name: string; language: string }) =>
          r.name === t.nombre && r.language === 'es'
      );
      if (remote) {
        if (
          remote.components?.find((c: { type: string }) => c.type === 'BODY')
            ?.text !== t.bodyText
        )
          throw new Error('Remote PDF copy mismatch: ' + t.nombre);
        const mirror = await db
          .from('message_templates')
          .update({
            meta_template_id: remote.id,
            waba_id: wabaId,
            meta_status: remote.status,
            status:
              remote.status === 'APPROVED'
                ? 'Approved'
                : remote.status === 'REJECTED'
                  ? 'Rejected'
                  : 'Pending',
          })
          .eq('workspace_id', WS)
          .eq('name', t.nombre)
          .eq('language', 'es');
        if (mirror.error) throw mirror.error;
        console.log(
          JSON.stringify({ template: t.nombre, reconciled: remote.id })
        );
        return;
      }
      const result = await crearPlantilla(db, {
        ...t,
        workspaceId: WS,
        userId: OWNER,
        enviarAMeta: true,
      });
      if (result.ok) {
        console.log(
          JSON.stringify({ template: t.nombre, meta: result.metaTemplateId })
        );
        return;
      }
      console.log(
        JSON.stringify({
          template: t.nombre,
          attempt: attempt + 1,
          submissionError: result,
        })
      );
    }
  };
  for (let i = 0; i < toSubmit.length; i += 3)
    await Promise.all(toSubmit.slice(i, i + 3).map(submit));
  // One paginated WABA listing instead of a request per template: Meta's
  // business-account quota is shared with all other account operations.
  const statuses = new Map<string, { id: string; status: string }>();
  let statusUrl: string | null =
    `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100&fields=id,name,language,status`;
  while (statusUrl) {
    const response: Response = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok)
      throw new Error(
        'Templates saved; Meta status sync HTTP ' + response.status
      );
    const page: {
      data?: Array<{ id: string; name: string; language: string; status: string }>;
      paging?: { next?: string };
    } = await response.json();
    for (const remote of page.data ?? [])
      if (remote.language === 'es') statuses.set(remote.name, remote);
    statusUrl = page.paging?.next ?? null;
  }
  for (const t of templates) {
    const remote = statuses.get(t.nombre);
    if (!remote) continue; // A failed submission remains an explicit local draft.
    const u = await db
      .from('message_templates')
      .update({
        meta_template_id: remote.id,
        waba_id: wabaId,
        meta_status: remote.status,
        status:
          remote.status === 'APPROVED'
            ? 'Approved'
            : remote.status === 'REJECTED'
              ? 'Rejected'
              : 'Pending',
      })
      .eq('workspace_id', WS)
      .eq('name', t.nombre)
      .eq('language', 'es');
    if (u.error) throw u.error;
  }
  for (const a of before.data)
    console.log(
      JSON.stringify({
        automation: a.name,
        ...(await armAutomation(db, a.id, WS)),
      })
    );
}
if (
  process.argv[1]?.replace(/\\/g, '/').endsWith('/reconcile-revitaly-flows.ts')
)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
