/** Applies the owner's September 2026 Revitaly brief. Run once; template creation is idempotent. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
  bodyText: string,
  buttons: EntradaCrearPlantilla['buttons'],
  category = 'MARKETING'
) {
  const name = `revitaly_${key}_v4`;
  templates.push({
    nombre: name,
    categoria: category,
    idioma: 'es',
    bodyText,
    buttons,
    bodySamples: ['Juan'],
    variableFields: { '1': 'recipient_first_name' },
    footerText: 'Responde BAJA para no recibir más recordatorios.',
  });
  return name;
}
const cart = [
  template(
    'carrito_1',
    'Hola {{1}}, soy Natalia de Revitaly 😊 Te quedó el tratamiento en el carrito.\n\n✅ Envío gratis a sucursal\n✅ Hasta 3 cuotas sin interés\n\nPuedes terminar tu compra desde el botón. ¿Algo te frenó? Responde y te ayudo.',
    buy
  ),
  template(
    'carrito_2_dudas',
    'Hola {{1}}, ¿te quedó alguna duda con Revitaly? 🤔\n\n✅ 90 días de garantía de satisfacción\n✅ Se usa como un shampoo común, en la ducha\n✅ Envío gratis a sucursal y hasta 3 cuotas sin interés\n\nTu carrito sigue guardado. Si tienes otra pregunta, escríbeme.',
    buy
  ),
  template(
    'carrito_3_cupon',
    'Hola {{1}}, para tu primera compra tienes un regalo 🎁\n\n5% OFF con el cupón REVITALY5, además del envío gratis a sucursal y las cuotas sin interés.\n\nPuedes aplicarlo al completar tu compra. ¿Te ayudo?',
    [link('Usar mi cupón', 'abandoned_checkout'), quick('Necesito ayuda')]
  ),
  template(
    'carrito_4_final',
    'Hola {{1}}, este es el último recordatorio de tu carrito de Revitaly.\n\nTienes 10% OFF con el cupón REVITALY10, de un uso por cliente.\n\nSi quieres continuar, usa el botón. Si no, elige “No, gracias” y dejamos de enviarte recordatorios.',
    [link('Sí, lo quiero', 'abandoned_checkout'), quick('No, gracias')]
  ),
];
const pending = [
  template(
    'pendiente_1',
    'Hola {{1}}, soy Natalia de Revitaly 😊 Tu pedido está reservado, solo falta completar el pago.\n\nSi elegiste Pago Fácil o Rapipago, revisa el cupón desde el estado de tu pedido. Si elegiste Mercado Pago, puedes retomar el pago desde allí.\n\nEl pago vence a las 24 horas de generar el pedido.',
    pay
  ),
  template(
    'pendiente_2',
    'Hola {{1}}, tu pedido sigue esperando el pago 📦\n\nSi se te complica pagar, tienes otras opciones:\n💳 Mercado Libre, con las cuotas disponibles en la publicación\n🏦 Transferencia por Alias/CVU con 10% OFF\n\nElige una opción y Natalia te ayuda con el enlace o el monto.',
    [
      link('Completar mi pago', 'order_status'),
      quick('Transferencia 10% OFF'),
      quick('Pagar por Mercado Libre'),
    ]
  ),
  template(
    'pendiente_3',
    'Hola {{1}}, recuerda completar el pago antes de que venza el plazo de 24 horas de tu pedido ⏰\n\nSi ya pagaste por Pago Fácil o Rapipago, puede tardar unas horas en acreditarse. Responde para avisarnos y dejamos de recordártelo.\n\nSi todavía no pagaste, puedes revisar tu pedido desde el botón.',
    pay
  ),
];
const rejected = [
  template(
    'rechazado_1',
    'Hola {{1}}, soy Natalia de Revitaly 😊 Tu pago no se pudo completar, pero tu carrito sigue guardado.\n\nPuede pasar por el límite o los fondos de la tarjeta, un dato mal cargado o un control de seguridad del banco.\n\nPuedes reintentar desde el botón. Si necesitas ayuda, responde este mensaje.',
    [link('Reintentar pago', 'abandoned_checkout'), quick('Necesito ayuda')]
  ),
  template(
    'rechazado_2',
    'Hola {{1}}, si la tarjeta sigue dando problemas, tienes otras opciones 👇\n\n💳 Comprar por Mercado Libre, con las cuotas disponibles en la publicación\n🏦 Transferencia por Alias/CVU con 10% OFF\n\nNatalia te ayuda con el enlace de tu presentación o los datos y el monto para transferir.',
    [
      quick('Pagar por Mercado Libre'),
      quick('Transferencia 10% OFF'),
      quick('Necesito ayuda'),
    ]
  ),
  template(
    'rechazado_3',
    'Hola {{1}}, ¿quieres que te ayude a terminar tu compra? 🙌\n\nResponde y revisamos una alternativa de pago o el enlace de tu carrito, para que puedas continuar sin empezar de nuevo.\n\nSi ya no quieres seguir, elige “No, gracias”.',
    [quick('Sí, ayúdame'), quick('No, gracias')]
  ),
];
const expired = template(
  'pago_vencido_carrito',
  'Hola {{1}}, si todavía quieres comprar Revitaly, puedes iniciar una nueva compra y usar REVITALY5 para obtener 5% OFF en tu primera compra.\n\nSi ya pagaste, no vuelvas a pagar: responde este mensaje y revisamos la acreditación.',
  [
    {
      type: 'URL',
      text: 'Ver Revitaly',
      url: 'https://revitaly.store/discount/REVITALY5?redirect=/products/revitaly-shampoo-revitalizador-crecimiento',
    },
    quick('Necesito ayuda'),
  ]
);
const care = [
  template(
    'postventa_uso',
    'Hola {{1}}, soy Natalia de Revitaly 😊 ¿Recibiste bien tu pedido?\n\nPara usarlo:\n1. Aplica el shampoo sobre el pelo húmedo.\n2. Masajea durante 2 a 3 minutos.\n3. Úsalo al menos 4 veces por semana.\n\nSi tienes alguna duda sobre tu pedido o el uso, responde y te ayudo.',
    [quick('Necesito ayuda'), stop],
    'UTILITY'
  ),
  template(
    'postventa_constancia',
    'Hola {{1}}, ¿cómo vas con el uso de tu Revitaly?\n\nRecuerda seguir las indicaciones del producto y mantener la constancia. Los resultados varían de una persona a otra.\n\n¿Tienes alguna duda sobre cómo usarlo?',
    [quick('Necesito ayuda'), stop],
    'UTILITY'
  ),
  template(
    'postventa_experiencia',
    'Hola {{1}}, ¿cómo ha sido tu experiencia con el Revitaly que recibiste? 😊\n\nCuéntame cómo te está resultando el uso. Si tienes alguna duda o inconveniente con tu pedido, lo revisamos.',
    [quick('Te cuento'), quick('Necesito ayuda'), stop],
    'UTILITY'
  ),
];
const stock = template(
  'recompra_cuanto_queda',
  'Hola {{1}}, ¿cómo vas con Revitaly? 😊\n\nTe escribo para que puedas organizar tu próxima compra con tiempo. Cada persona usa una cantidad distinta.\n\n¿Cuánto te queda?',
  [quick('Me queda poco'), quick('Tengo para rato'), stop]
);
const offers: Record<number, string> = {};
for (const [bought, next, price] of [
  [1, 2, '61.990'],
  [2, 3, '71.990'],
  [3, 10, '125.990'],
  [10, 10, '125.990'],
]) {
  offers[Number(bought)] = template(
    `recompra_oferta_${bought}`,
    `Hola {{1}}, para continuar con Revitaly tienes esta opción 🎁\n\n🧴 Pack de ${next} botellas: $${price} ARS\n🎟 10% OFF extra con CLIENTE10, un uso por cliente\n\nEnvío gratis a sucursal y hasta 3 cuotas sin interés. Elige el pack o cuéntame qué prefieres.`,
    [
      quick(`Quiero ${next} botellas`),
      quick(bought === 1 ? 'Solo 1 botella' : `Repetir ${bought} botellas`),
      quick('Necesito ayuda'),
    ]
  );
}
const timely = template(
  'recompra_pedir_a_tiempo',
  'Hola {{1}}, ¿cómo vas con Revitaly? ⏰\n\nEl envío tarda unos días. Si te queda poco, puedes pedirlo con tiempo para tenerlo antes de que se termine.\n\nRecuerda tu cupón CLIENTE10. ¿Te ayudo a elegir el pack?',
  [quick('Pedir ahora'), quick('Necesito ayuda'), stop]
);
const returnMsg = template(
  'recompra_retomar',
  'Hola {{1}}, ¿se te terminó Revitaly? 🤔\n\nSi quieres retomarlo, te ayudo a elegir tu próximo pack y confirmar el plazo de envío.\n\nSi decidiste no seguir, cuéntame por qué. Tu experiencia nos ayuda a mejorar.',
  [quick('Quiero retomarlo'), quick('Te cuento'), stop]
);

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
  if (!existsSync('tmp/revitaly-before-v4.json')) {
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
      'tmp/revitaly-before-v4.json',
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
  // Draft the entire reviewed message set before submitting it to Meta.
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
      enviarAMeta: true,
    });
    if (!result.ok) throw new Error(t.nombre + ': ' + JSON.stringify(result));
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
  const comments = await db
    .from('ig_proactive_settings')
    .upsert(
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
  const { accessToken } = await resolverWabaYToken(db, WS, OWNER);
  const ts = await db
    .from('message_templates')
    .select('id,name,meta_template_id')
    .eq('workspace_id', WS)
    .not('meta_template_id', 'is', null);
  if (ts.error) throw ts.error;
  for (const t of ts.data) {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${t.meta_template_id}?fields=status`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) throw new Error('Meta status ' + r.status);
    const remote = await r.json();
    const raw = String(remote.status);
    const u = await db
      .from('message_templates')
      .update({
        meta_status: raw,
        status:
          raw === 'APPROVED'
            ? 'Approved'
            : raw === 'REJECTED'
              ? 'Rejected'
              : 'Pending',
      })
      .eq('workspace_id', WS)
      .eq('id', t.id);
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
