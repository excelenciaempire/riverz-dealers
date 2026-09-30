/** Restyles the already isolated presentation account. Never touches source accounts.
 * Keep provenance private in tmp/. Runtime protection must be deployed before
 * --runtime-verified makes the configured motor appear enabled.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const receiptPath = 'tmp/flota-demo-receipt.json';
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const workspaceId = '165c45e4-c67d-4c79-b00a-c14bafe888f6';
if (receipt.workspaceId !== workspaceId)
  throw new Error('Wrong presentation workspace');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .flatMap((line) => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      return m ? [[m[1], m[2].replace(/^['"]|['"]$/g, '')]] : [];
    })
);
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
const ws = checked(
  await db.from('workspaces').select('owner_id').eq('id', workspaceId).single()
);
if (ws.owner_id !== receipt.userId) throw new Error('Ownership mismatch');
if (process.argv.includes('--runtime-verified')) {
  const proof = JSON.parse(
    readFileSync('tmp/presentation-runtime-verification.json', 'utf8')
  );
  if (
    !proof.runtimeProtected ||
    !proof.providerBlocked ||
    proof.workspaceId !== workspaceId ||
    Date.now() - Date.parse(proof.checkedAt) > 600000
  )
    throw new Error('Fresh runtime verification required');
  if (process.argv.includes('--enable-display-only')) {
    checked(
      await db
        .from('workspaces')
        .update({ motor_apagado_at: null, motor_apagado_por: null })
        .eq('id', workspaceId)
        .eq('owner_id', receipt.userId)
    );
    console.log(
      JSON.stringify({
        workspaceId,
        visualMotorEnabled: true,
        runtimeProtected: true,
      })
    );
    process.exit(0);
  }
}

const firstNames = [
  'Ana',
  'Alejandro',
  'Alma',
  'Ángel',
  'Andrea',
  'Ariana',
  'Bruno',
  'Carla',
  'Carlos',
  'Cecilia',
  'Clara',
  'Cristian',
  'Diana',
  'Eduardo',
  'Elena',
  'Emilio',
  'Esteban',
  'Fernanda',
  'Gabriela',
  'Gabriel',
  'Guillermo',
  'Isabel',
  'Iván',
  'Javier',
  'Jimena',
  'Joaquín',
  'José',
  'Juliana',
  'Julieta',
  'Leonardo',
  'Lorena',
  'Luis',
  'Manuel',
  'Marcela',
  'Martín',
  'Mónica',
  'Noelia',
  'Óscar',
  'Patricia',
  'Pedro',
  'Rafael',
  'Renata',
  'Ricardo',
  'Roberto',
  'Rodrigo',
  'Rosa',
  'Samuel',
  'Sofía',
  'Valeria',
  'Victoria',
];
const surnames = [
  'Acosta',
  'Aguilar',
  'Alonso',
  'Álvarez',
  'Arias',
  'Benítez',
  'Cabrera',
  'Campos',
  'Cárdenas',
  'Carrillo',
  'Cortés',
  'Delgado',
  'Díaz',
  'Espinosa',
  'Flores',
  'García',
  'Gómez',
  'González',
  'Guzmán',
  'López',
  'Maldonado',
  'Mendoza',
  'Navarro',
  'Núñez',
  'Ortiz',
  'Paredes',
  'Pérez',
  'Ramírez',
  'Reyes',
  'Romero',
  'Ruiz',
  'Salazar',
  'Sánchez',
  'Silva',
  'Soto',
  'Valdés',
  'Vásquez',
  'Vega',
  'Velasco',
  'Zamora',
];
function randomFor(key) {
  let state = createHash('sha256').update(key).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
function shuffled(items, key) {
  const result = [...items];
  const random = randomFor(key);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const all = checked(
  await db
    .from('conversations')
    .select('id,contact_id,channel,subject,ai_summary')
    .eq('workspace_id', workspaceId)
    .order('id')
);
const auditPath = 'tmp/flota-presentation-style.json';
let audit;
try {
  audit = JSON.parse(readFileSync(auditPath, 'utf8'));
} catch {
  audit = null;
}
if (!audit) {
  const used = new Set();
  const direct = all.filter((c) => !c.channel.includes('comment'));
  const comments = all.filter((c) => c.channel.includes('comment'));
  const directChannels = shuffled(
    Array.from(
      { length: direct.length },
      (_, i) =>
        [
          'whatsapp',
          'whatsapp',
          'whatsapp',
          'instagram',
          'instagram',
          'messenger',
          'gmail',
          'outlook',
          'webchat',
        ][i % 9]
    ),
    'channels'
  );
  const commentChannels = shuffled(
    Array.from(
      { length: comments.length },
      (_, i) =>
        [
          'fb_comment',
          'fb_comment',
          'ig_comment',
          'ig_comment',
          'tiktok_comment',
        ][i % 5]
    ),
    'comments'
  );
  audit = all.map((c) => {
    const random = randomFor(c.id);
    let alias;
    do {
      alias = `${firstNames[Math.floor(random() * firstNames.length)]} ${surnames[Math.floor(random() * surnames.length)]}`;
    } while (used.has(alias));
    used.add(alias);
    return {
      conversationId: c.id,
      contactId: c.contact_id,
      alias,
      originalChannel: c.channel,
      channel: c.channel.includes('comment')
        ? commentChannels[comments.findIndex((x) => x.id === c.id)]
        : directChannels[direct.findIndex((x) => x.id === c.id)],
    };
  });
  writeFileSync(auditPath, JSON.stringify(audit, null, 2));
}
function clean(text, oldName, alias) {
  const first = alias.split(' ')[0];
  return String(text ?? '')
    .replaceAll(oldName, alias)
    .replace(new RegExp(`\\b${oldName.split(' ')[0]}\\b`, 'g'), first)
    .replace(
      /https?:\/\/example\.invalid\/\S*/gi,
      'https://nativa.example/tienda'
    )
    .replace(
      /cliente\d+@example\.invalid/gi,
      `${first.toLowerCase()}@nativa.example`
    )
    .replace(/#DEMO[-\s]*\d*/gi, '#1042')
    .replace(/\[fecha de demostración\]/gi, '21 de septiembre')
    .replace(/\[dato privado\]/gi, 'el dato solicitado')
    .replace(/\bDemo\s*[·-]?\s*/gi, '')
    .replace(/demostraci[oó]n|simulaci[oó]n/gi, 'atención')
    .replace(/\s*[·-]\s*$/, '')
    .trim();
}
for (const item of audit) {
  const old = checked(
    await db
      .from('contacts')
      .select('name')
      .eq('id', item.contactId)
      .eq('workspace_id', workspaceId)
      .single()
  );
  const messages = checked(
    await db
      .from('messages')
      .select('id,content_text,origin_name,created_at')
      .eq('conversation_id', item.conversationId)
      .order('created_at')
  );
  const tagRows = checked(
    await db
      .from('contact_tags')
      .select('tags(name)')
      .eq('contact_id', item.contactId)
  );
  const topic =
    tagRows
      .map((row) => row.tags?.name)
      .find((name) => name && name !== 'Comentario') ??
    'Consulta por productos';
  const updates = messages.map((message) => ({
    id: message.id,
    content_text: clean(message.content_text, old.name, item.alias),
    channel: item.channel,
    origin_name: message.origin_name
      ? clean(message.origin_name, old.name, item.alias)
      : null,
  }));
  for (const update of updates)
    checked(
      await db
        .from('messages')
        .update(update)
        .eq('id', update.id)
        .eq('conversation_id', item.conversationId)
    );
  checked(
    await db
      .from('contacts')
      .update({
        name: item.alias,
        company: 'Nativa Store',
        channel: item.channel,
        ai_summary: `Consulta de ${topic.toLowerCase()}.`,
        external_id: `contact-${item.contactId.slice(0, 12)}`,
      })
      .eq('id', item.contactId)
      .eq('workspace_id', workspaceId)
  );
  checked(
    await db
      .from('conversations')
      .update({
        channel: item.channel,
        subject: topic,
        ai_summary: `Consulta de ${topic.toLowerCase()}. Revisar el historial para continuar la atención.`,
        needs_human_summary:
          'El equipo debe revisar el caso y continuar la atención.',
        last_message_text: updates.at(-1)?.content_text.slice(0, 200),
        thread_external_id: item.channel.includes('comment')
          ? `post-${item.conversationId.slice(0, 8)}`
          : null,
      })
      .eq('id', item.conversationId)
      .eq('workspace_id', workspaceId)
  );
  checked(
    await db
      .from('contact_notes')
      .update({ note_text: `Consulta de ${topic.toLowerCase()}.` })
      .eq('contact_id', item.contactId)
      .eq('user_id', receipt.userId)
  );
  checked(
    await db
      .from('comments_meta')
      .update({
        post_id: `post-${item.conversationId.slice(0, 8)}`,
        parent_comment_id: `comment-${item.conversationId.slice(0, 8)}`,
        permalink: `https://nativa.example/publicaciones/${item.conversationId.slice(0, 8)}`,
      })
      .in(
        'message_id',
        messages.map((message) => message.id)
      )
  );
}

const agents = checked(
  await db
    .from('ai_agents')
    .select('id,name,role')
    .eq('workspace_id', workspaceId)
);
for (const agent of agents)
  checked(
    await db
      .from('ai_agents')
      .update({
        name: clean(agent.name, '', ''),
        is_active: true,
        persona: `Eres el agente de ${agent.role} de Nativa Store. Responde con claridad y pregunta si falta información.`,
        knowledge:
          'Kit Esencial: organizador y dos accesorios, 99000 COP. Kit Completo: organizador, cuatro accesorios y estuche, 149000 COP. Envíos en 3 a 5 días hábiles. Reembolsos y pagos requieren revisión humana.',
      })
      .eq('id', agent.id)
      .eq('workspace_id', workspaceId)
  );
const flows = checked(
  await db.from('automations').select('id,name').eq('workspace_id', workspaceId)
);
for (const flow of flows)
  checked(
    await db
      .from('automations')
      .update({
        name: clean(flow.name, '', ''),
        description: 'Seguimiento configurado para Nativa Store.',
        is_active: true,
        activation_state: 'active',
      })
      .eq('id', flow.id)
      .eq('workspace_id', workspaceId)
  );
checked(
  await db
    .from('shopify_products')
    .update({
      description: 'Producto del catálogo Nativa Store.',
      training_material: null,
    })
    .eq('workspace_id', workspaceId)
);
for (const product of checked(
  await db
    .from('shopify_products')
    .select('id,title')
    .eq('workspace_id', workspaceId)
)) {
  const handle = product.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
  checked(
    await db
      .from('shopify_products')
      .update({ handle })
      .eq('id', product.id)
      .eq('workspace_id', workspaceId)
  );
}
checked(
  await db
    .from('channel_connections')
    .update({
      label: 'Chat web · Nativa Store',
      config: {
        enabled: false,
        brand_name: 'Nativa Store',
        allow_uploads: false,
      },
    })
    .eq('workspace_id', workspaceId)
);
checked(
  await db
    .from('workspaces')
    .update({
      name: 'Nativa Store',
      slug: 'nativa-store',
      ...(process.argv.includes('--runtime-verified')
        ? { motor_apagado_at: null, motor_apagado_por: null }
        : {}),
    })
    .eq('id', workspaceId)
    .eq('owner_id', receipt.userId)
);
checked(
  await db
    .from('workspace_subscriptions')
    .update({
      estado: 'activa',
      modelo_cobro: 'oficial',
      precio_centavos_override: 0,
      excedente_centavos_override: 0,
      nota: 'Cuenta interna de presentación. Sin facturación ni actividad externa.',
    })
    .eq('workspace_id', workspaceId)
);
const email = 'nativa@riverz.co';
const user = checked(await db.auth.admin.getUserById(receipt.userId));
checked(
  await db.auth.admin.updateUserById(receipt.userId, {
    email,
    email_confirm: true,
    user_metadata: {
      ...user.user.user_metadata,
      full_name: 'Nativa Store',
      workspace_name: 'Nativa Store',
    },
    app_metadata: { ...user.user.app_metadata, presentation: true },
  })
);
checked(
  await db
    .from('profiles')
    .update({ full_name: 'Nativa Store', email })
    .eq('user_id', receipt.userId)
);
receipt.email = email;
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
writeFileSync(
  'output/demo/acceso-flota-demo.txt',
  `URL: https://riverz.co/ingresar\nCorreo: ${email}\nContraseña: ${receipt.password}\n\n` +
    'Cuenta: Nativa Store. Cuenta interna de presentación, con datos de ejemplo.\n' +
    'Los controles se muestran activos. El servidor bloquea ejecución, proveedores y cobros.\n'
);
const channels = {};
for (const item of audit)
  channels[item.channel] = (channels[item.channel] ?? 0) + 1;
console.log(
  JSON.stringify(
    {
      workspaceId,
      account: 'Nativa Store',
      conversations: audit.length,
      uniqueNames: new Set(audit.map((item) => item.alias)).size,
      channels,
      agents: agents.length,
      configuredActiveFlows: flows.length,
      subscription: 'active_zero_cost',
      visualMotorEnabled: process.argv.includes('--runtime-verified'),
    },
    null,
    2
  )
);
