/**
 * Creates the isolated VSL demonstration account from reviewed, anonymized
 * conversation samples. No production channel tokens, attachments, customer
 * identities, orders, delivery jobs or provider sends are copied.
 *
 * Usage: node scripts/provision-flota-demo.mjs --source tmp/demo-safe.json
 * Credentials and provenance remain in ignored tmp/, never in Git.
 * Reruns require the local receipt and cannot replace an existing account.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--source')) throw new Error('--source is required');
const sourcePath = arg('--source');
const samples = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (!Array.isArray(samples) || samples.length < 20)
  throw new Error('At least 20 reviewed samples required');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
    })
);
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const fail = (error) => {
  if (error) throw new Error(error.message);
};
const checked = (result) => {
  fail(result.error);
  return result.data;
};
const receiptPath = 'tmp/flota-demo-receipt.json';
const now = new Date();
let receipt;

if (existsSync(receiptPath)) {
  receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const workspace = checked(
    await db
      .from('workspaces')
      .select('id,owner_id,slug')
      .eq('id', receipt.workspaceId)
      .single()
  );
  if (
    workspace.owner_id !== receipt.userId ||
    workspace.slug !== 'flota-demo-vsl'
  ) {
    throw new Error('Demo ownership check failed');
  }
} else {
  const email = 'demo.flota@riverz.co';
  const password = `Flota!${randomBytes(15).toString('base64url')}`;
  const user = checked(
    await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'Flota Demo',
        workspace_name: 'Flota Demo · Casos de demostración',
        demo: true,
        purpose: 'VSL demo; anonymized replays; no external sends',
      },
    })
  );
  const userId = user.user.id;
  const existing = checked(
    await db
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .limit(1)
  );
  const workspaceId =
    existing[0]?.id ??
    checked(
      await db
        .from('workspaces')
        .insert({
          owner_id: userId,
          name: 'Flota Demo · Casos de demostración',
        })
        .select('id')
        .single()
    ).id;
  receipt = {
    userId,
    workspaceId,
    email,
    password,
    createdAt: now.toISOString(),
  };
  mkdirSync('tmp', { recursive: true });
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
}

const { userId, workspaceId } = receipt;
checked(
  await db
    .from('workspaces')
    .update({
      name: 'Flota Demo · Casos de demostración',
      slug: 'flota-demo-vsl',
      timezone: 'America/Bogota',
      csat_enabled: false,
      motor_apagado_at: now.toISOString(),
      motor_apagado_por: userId,
    })
    .eq('id', workspaceId)
    .eq('owner_id', userId)
);
checked(
  await db.from('workspace_members').upsert(
    {
      workspace_id: workspaceId,
      user_id: userId,
      role: 'admin',
      allowed_sections: null,
    },
    { onConflict: 'workspace_id,user_id' }
  )
);
checked(
  await db.from('profiles').upsert(
    {
      user_id: userId,
      full_name: 'Flota Demo',
      email: receipt.email,
      locale: 'es',
      timezone: 'America/Bogota',
    },
    { onConflict: 'user_id' }
  )
);
checked(
  await db.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      estado: 'cortesia',
      precio_centavos_override: 0,
      incluidas_override: 1000,
      modelo_cobro: 'oficial',
      nota: 'Cuenta interna de demostración. Reproducciones anonimizadas; no actividad comercial real.',
    },
    { onConflict: 'workspace_id' }
  )
);

const roles = [
  [
    'ventas',
    'Ventas',
    'Responde dudas sobre productos, compara opciones y asesora antes de comprar.',
  ],
  [
    'recuperacion',
    'Recuperación',
    'Ayuda a retomar carritos y pagos pendientes sin insistir si ya compró.',
  ],
  [
    'postventa',
    'Atención de pedidos',
    'Explica el seguimiento y prepara cambios o devoluciones para revisión humana.',
  ],
  [
    'retencion',
    'Recompras',
    'Asesora sobre reposición y complementos según la compra anterior.',
  ],
];
const agentIds = {};
for (const [role, name, task] of roles) {
  const existing = checked(
    await db
      .from('ai_agents')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('role', role)
      .is('deleted_at', null)
      .limit(1)
  );
  const id = existing[0]?.id ?? randomUUID();
  checked(
    await db.from('ai_agents').upsert({
      id,
      workspace_id: workspaceId,
      name: `${name} · Demo`,
      role,
      is_active: true,
      scope: 'workspace',
      priority: role === 'ventas' ? 1 : 10,
      persona:
        `${task} Estás en una cuenta de demostración. Identifica las acciones simuladas como tales. ` +
        'Nunca afirmes que se emitió una guía, cobró un pago o aprobó un reembolso real. ' +
        'Responde en español neutro, con claridad. Si falta un dato, pregunta. Escala las decisiones sensibles.',
      knowledge:
        'Catálogo ficticio de demostración: Kit Esencial, 99.000 COP; Kit Completo, 149.000 COP. ' +
        'Envío nacional de demostración: 3 a 5 días hábiles. Se puede explicar tarjeta o transferencia, ' +
        'pero no se reciben pagos reales. Una devolución se recopila para aprobación humana. ' +
        'Las conversaciones de la bandeja son reproducciones anonimizadas de escenarios de distintas marcas, ' +
        'con nombres y fechas de demostración. Nunca las presentes como ventas de esta tienda.',
      language: 'es',
      tone: 'friendly',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      context_messages: 16,
      max_response_chars: 750,
      reply_delay_seconds: 0,
      reply_when_assigned: true,
      followup_enabled: false,
      voice_enabled: false,
      puede_crear_pedidos: false,
      permissions: {
        crear_pedidos: false,
        crear_checkout: false,
        registrar_pago: false,
        editar_pedido: false,
        enviar_proactivo: false,
        escalar_llamada: false,
      },
      requires_approval: true,
      created_by: userId,
    })
  );
  agentIds[role] = id;
}

// A fictional manual catalog supplies approved prices to the real simulator.
// No store connection, checkout URL or inventory is created.
for (const [index, title, price, description] of [
  [
    1,
    'Kit Esencial',
    99000,
    'Un organizador y dos accesorios. Ejemplo ficticio de demostración.',
  ],
  [
    2,
    'Kit Completo',
    149000,
    'Un organizador, cuatro accesorios y un estuche. Ejemplo ficticio de demostración.',
  ],
]) {
  const previous = checked(
    await db
      .from('shopify_products')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('shop_domain', 'manual')
      .eq('title', title)
      .limit(1)
  );
  const id = previous[0]?.id ?? randomUUID();
  checked(
    await db.from('shopify_products').upsert({
      id,
      user_id: userId,
      workspace_id: workspaceId,
      shop_domain: 'manual',
      external_id: -9000000000 - index,
      handle: `kit-demo-${index}`,
      title,
      description,
      price_min: price,
      price_max: price,
      currency: 'COP',
      allowed_offers: [
        { label: 'Precio de demostración', total: price, units: 1 },
      ],
      training_material: `${title}. ${description} Precio autorizado: ${price} COP.`,
      scrape_status: 'done',
      synced_at: now.toISOString(),
    })
  );
}

// The one real internal connection has no provider credentials and stays disabled.
// It allows the simulator to be configured without connecting a customer's account.
const oldWebchat = checked(
  await db
    .from('channel_connections')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'webchat')
    .limit(1)
);
checked(
  await db.from('channel_connections').upsert({
    id: oldWebchat[0]?.id ?? randomUUID(),
    workspace_id: workspaceId,
    channel: 'webchat',
    label: 'Chat web · Demostración',
    status: 'connected',
    created_by: userId,
    config: {
      enabled: false,
      brand_name: 'Flota Demo',
      greeting: 'Demostración de atención con IA',
      allowed_domains: ['riverz.co'],
      agent_id: agentIds.ventas,
      require_email: false,
      allow_uploads: false,
    },
    secrets: {},
  })
);

const tagIds = {};
const tagNames = [
  'Venta',
  'Recuperación',
  'Pedido y seguimiento',
  'Recompra',
  'Revisión humana',
  'Comentario',
];
for (const [index, name] of tagNames.entries()) {
  const old = checked(
    await db
      .from('tags')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('name', name)
      .limit(1)
  );
  const id = old[0]?.id ?? randomUUID();
  checked(
    await db.from('tags').upsert({
      id,
      workspace_id: workspaceId,
      user_id: userId,
      name,
      color: ['#A3B337', '#D6A84D', '#638B85', '#8A79AB', '#B56D61', '#7C91AD'][
        index
      ],
    })
  );
  tagIds[name] = id;
}

function classify(sample) {
  const content = sample.messages.map((m) => m.content_text).join('\n');
  if (
    sample.needs_human_reason ||
    /reembolso|devoluci[oó]n|dañado|cancelar|hablar.*persona/i.test(content)
  )
    return ['postventa', 'Revisión humana'];
  if (
    /recompra|reponer|otra vez|comprar de nuevo|segunda compra|comprar nuevamente/i.test(
      content
    )
  )
    return ['retencion', 'Recompra'];
  if (
    /carrito|rechazad|pago pendiente|abandon|transferencia pendiente/i.test(
      content
    )
  )
    return ['recuperacion', 'Recuperación'];
  if (
    /gu[ií]a|seguimiento|d[oó]nde.*pedido|despach|rastre|pedido.*confirmad/i.test(
      content
    )
  )
    return ['postventa', 'Pedido y seguimiento'];
  return ['ventas', 'Venta'];
}

const firstNames = [
  'Camila',
  'Mateo',
  'Valentina',
  'Santiago',
  'Laura',
  'Sebastián',
  'Daniela',
  'Andrés',
  'Mariana',
  'Nicolás',
  'Carolina',
  'David',
  'Paula',
  'Felipe',
  'Natalia',
  'Juan',
  'Sara',
  'Diego',
  'Lucía',
  'Tomás',
];
const surnames = [
  'Torres',
  'Medina',
  'Castro',
  'Vargas',
  'Morales',
  'Rojas',
  'Herrera',
  'Suárez',
];
const manifest = existsSync('tmp/flota-demo-provenance.json')
  ? JSON.parse(readFileSync('tmp/flota-demo-provenance.json', 'utf8'))
  : [];

function demoText(text, alias, index) {
  return text
    .replace(/\[cliente demo\]|cliente demo/gi, alias.split(' ')[0])
    .replace(/\[correo demo\]/g, `cliente${index + 1}@example.invalid`)
    .replace(/\[enlace de demostración\]/g, 'https://example.invalid/demo')
    .replace(/#DEMO\b/g, `#DEMO-${String(index + 1).padStart(3, '0')}`)
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[fecha de demostración]');
}

const already = checked(
  await db
    .from('conversations')
    .select('id,subject')
    .eq('workspace_id', workspaceId)
);
const existingSubjects = new Set(already.map((c) => c.subject));
for (const [index, sample] of samples.entries()) {
  const subject = `Demo · ${sample.source_brand} · ${sample.source_id.slice(0, 8)}`;
  if (existingSubjects.has(subject)) continue;
  const [role, scenario] = classify(sample);
  const alias = `${firstNames[index % firstNames.length]} ${surnames[Math.floor(index / firstNames.length) % surnames.length]}`;
  const contactId = randomUUID();
  const convId = randomUUID();
  const newestAt = new Date(now.getTime() - index * 23 * 60_000);
  const oldestAt = new Date(
    newestAt.getTime() - (sample.messages.length - 1) * 75_000
  );
  const finalMessage = sample.messages.at(-1);
  const needsHuman = Boolean(sample.needs_human_reason);
  const rows = sample.messages.map((message, offset) => ({
    id: randomUUID(),
    conversation_id: convId,
    sender_type: message.sender_type,
    content_type:
      message.content_type === 'template' ? 'text' : message.content_type,
    content_text: demoText(message.content_text, alias, index),
    channel: sample.channel,
    status: message.status === 'sending' ? 'sent' : message.status,
    created_at: new Date(oldestAt.getTime() + offset * 75_000).toISOString(),
    message_id: `demo-${convId}-${offset}`,
    origin: message.origin,
    origin_name: message.origin
      ? `Demo · ${message.origin_name ?? scenario}`
      : null,
    is_hidden: false,
  }));
  for (const message of rows) {
    if (
      /[0-9]{7,}|\b(?:c[eé]dula|dni|cbu|cuit|mi direcci[oó]n|cuenta bancaria)\b/i.test(
        message.content_text
      )
    )
      throw new Error(
        `Privacy validation failed for source ${sample.source_id}`
      );
  }
  checked(
    await db.from('contacts').insert({
      id: contactId,
      workspace_id: workspaceId,
      user_id: userId,
      channel: sample.channel,
      external_id: `demo-${index + 1}`,
      name: alias,
      company: `Demo · ${sample.source_brand}`,
      phone: null,
      email: null,
      ai_summary: `Demostración anonimizada: ${scenario}. Marca de origen: ${sample.source_brand}.`,
      voice_opt_out: true,
      created_at: oldestAt.toISOString(),
    })
  );
  checked(
    await db.from('conversations').insert({
      id: convId,
      workspace_id: workspaceId,
      user_id: userId,
      contact_id: contactId,
      channel: sample.channel,
      subject,
      connection_id: null,
      status: needsHuman ? 'pending' : 'open',
      assigned_ai_agent_id: agentIds[role],
      last_message_text: rows.at(-1).content_text.slice(0, 200),
      last_message_at: newestAt.toISOString(),
      last_sender_type: finalMessage.sender_type,
      last_message_status:
        finalMessage.sender_type === 'customer' ? null : finalMessage.status,
      unread_count: needsHuman ? 1 : 0,
      is_ad: Boolean(sample.is_ad),
      ai_enabled: false,
      needs_human_reason: needsHuman ? sample.needs_human_reason : null,
      needs_human_at: needsHuman ? newestAt.toISOString() : null,
      needs_human_summary: needsHuman
        ? 'Caso de demostración pendiente de revisión humana. Consulta el historial.'
        : null,
      created_at: oldestAt.toISOString(),
      followup_count: 0,
      ai_summary:
        `DEMO: reproducción anonimizada de un caso de ${sample.source_brand}. ` +
        'Identidad ficticia y fechas desplazadas. No se enviaron estos mensajes desde esta cuenta.',
    })
  );
  checked(await db.from('messages').insert(rows));
  if (sample.channel.includes('comment')) {
    const parent = `demo-comment-${convId}`;
    checked(
      await db
        .from('conversations')
        .update({ thread_external_id: `demo-post-${index + 1}` })
        .eq('id', convId)
    );
    checked(
      await db.from('comments_meta').insert(
        rows
          .filter((m) => m.sender_type === 'customer')
          .map((m) => ({
            message_id: m.id,
            post_id: `demo-post-${index + 1}`,
            parent_comment_id: parent,
            is_ad: Boolean(sample.is_ad),
            permalink: null,
          }))
      )
    );
  }
  const tags = [
    tagIds[scenario],
    ...(sample.channel.includes('comment') ? [tagIds.Comentario] : []),
  ];
  checked(
    await db
      .from('contact_tags')
      .insert(tags.map((tag_id) => ({ contact_id: contactId, tag_id })))
  );
  checked(
    await db.from('contact_notes').insert({
      contact_id: contactId,
      user_id: userId,
      note_text:
        `DEMOSTRACIÓN: ${scenario}, basado en ${sample.source_brand}. ` +
        'Texto anonimizado; identidad ficticia; fechas desplazadas para recorrer la bandeja. ' +
        'Se conserva quién respondió y el estado registrado. No es una venta nueva ni un envío real.',
    })
  );
  manifest.push({
    demoConversationId: convId,
    sourceConversationId: sample.source_id,
    sourceBrand: sample.source_brand,
    channel: sample.channel,
    scenario,
    messages: rows.length,
    originalMessageIds: sample.messages.map((m) => m.id),
  });
}
writeFileSync(
  'tmp/flota-demo-provenance.json',
  JSON.stringify(manifest, null, 2)
);

// Paused draft examples can be inspected and run through the existing
// simulator. They contain no execution history and enqueue no jobs.
const flowExamples = [
  [
    'Carrito abandonado · Demo',
    'shopify_abandoned_checkout',
    1,
    'hours',
    'recuperacion',
    'Tu carrito sigue disponible. ¿Tienes alguna duda para completar la compra?',
  ],
  [
    'Pago rechazado · Demo',
    'payment_rejected',
    10,
    'minutes',
    'recuperacion',
    'El pago de tu pedido no se completó. ¿Quieres revisar otra forma de pago?',
  ],
  [
    'Pago pendiente · Demo',
    'payment_pending',
    1,
    'hours',
    'recuperacion',
    'Tu pedido está pendiente de pago. Si tienes un comprobante, lo dejamos para revisión.',
  ],
  [
    'Confirmación de pedido · Demo',
    'shopify_order_created',
    0,
    'minutes',
    'postventa',
    'Recibimos el pedido {{vars.order_name}}. Te avisamos cuando esté listo para salir.',
  ],
  [
    'Envío de guía · Demo',
    'shopify_order_fulfilled',
    0,
    'minutes',
    'postventa',
    'Tu pedido {{vars.order_name}} fue despachado. Guía: {{vars.tracking_number}}.',
  ],
  [
    'Recompra · Demo',
    'shopify_order_delivered',
    30,
    'days',
    'retencion',
    '¿Necesitas volver a pedir? Podemos ayudarte a elegir la reposición o un complemento.',
  ],
];
for (const [name, trigger_type, amount, unit, role, body] of flowExamples) {
  const old = checked(
    await db
      .from('automations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('name', name)
      .is('deleted_at', null)
      .limit(1)
  );
  const id = old[0]?.id ?? randomUUID();
  checked(
    await db.from('automations').upsert({
      id,
      workspace_id: workspaceId,
      user_id: userId,
      name,
      description:
        'Ejemplo de configuración para demostración. Pausado y sin envíos reales.',
      trigger_type,
      trigger_config: { handoff_ai_agent_id: agentIds[role] },
      is_active: false,
      activation_state: 'draft',
      execution_count: 0,
    })
  );
  const steps = [];
  if (amount) steps.push({ step_type: 'wait', step_config: { amount, unit } });
  steps.push({ step_type: 'send_message', step_config: { text: body } });
  const oldSteps = checked(
    await db
      .from('automation_steps')
      .select('id,position')
      .eq('automation_id', id)
  );
  checked(
    await db.from('automation_steps').upsert(
      steps.map((step, position) => ({
        id:
          oldSteps.find((oldStep) => oldStep.position === position)?.id ??
          randomUUID(),
        automation_id: id,
        parent_step_id: null,
        branch: null,
        position,
        ...step,
      }))
    )
  );
}

const total = checked(
  await db
    .from('conversations')
    .select('id,channel,needs_human_reason')
    .eq('workspace_id', workspaceId)
);
const counts = {};
for (const conv of total)
  counts[conv.channel] = (counts[conv.channel] ?? 0) + 1;
const { count: messageCount, error: countError } = await db
  .from('messages')
  .select('id,conversations!inner(workspace_id)', {
    count: 'exact',
    head: true,
  })
  .eq('conversations.workspace_id', workspaceId);
fail(countError);
const connections = checked(
  await db
    .from('channel_connections')
    .select('channel,secrets')
    .eq('workspace_id', workspaceId)
);
if (
  connections.some(
    (c) => c.channel !== 'webchat' || Object.keys(c.secrets ?? {}).length
  )
)
  throw new Error('Demo must not contain external channel credentials');
const flows = checked(
  await db
    .from('automations')
    .select('id,is_active,activation_state')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
);
if (
  flows.length !== 6 ||
  flows.some((flow) => flow.is_active || flow.activation_state !== 'draft')
)
  throw new Error('Expected six paused demonstration flows');
const anon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
checked(
  await anon.auth.signInWithPassword({
    email: receipt.email,
    password: receipt.password,
  })
);
const visible = checked(
  await anon.from('conversations').select('id,workspace_id')
);
if (
  visible.length !== total.length ||
  visible.some((c) => c.workspace_id !== workspaceId)
)
  throw new Error('Demo RLS visibility mismatch');
await anon.auth.signOut({ scope: 'local' });
mkdirSync('output/demo', { recursive: true });
writeFileSync(
  'output/demo/acceso-flota-demo.txt',
  `URL: https://riverz.co/ingresar\nCorreo: ${receipt.email}\nContraseña: ${receipt.password}\n\n` +
    'Cuenta: Flota Demo. Contiene reproducciones anonimizadas con identidades ficticias.\n' +
    'La bandeja es navegable. Para una respuesta nueva usa Asistente > Probar como cliente.\n' +
    'El motor y los envíos externos están apagados. No conectar canales reales.\n'
);
const summary = {
  workspaceId,
  email: receipt.email,
  conversations: total.length,
  messages: messageCount,
  channels: counts,
  needsHuman: total.filter((c) => c.needs_human_reason).length,
  agents: Object.keys(agentIds).length,
  pausedAutomations: flows.length,
  fictionalProducts: 2,
  sourceSha256: createHash('sha256')
    .update(readFileSync(sourcePath))
    .digest('hex'),
  externalCredentials: false,
  externalSending: false,
  authAndRlsVerified: true,
};
writeFileSync(
  'tmp/flota-demo-validation.json',
  JSON.stringify(summary, null, 2)
);
console.log(JSON.stringify(summary, null, 2));
