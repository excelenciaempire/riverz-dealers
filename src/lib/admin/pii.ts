/**
 * Barrera de privacidad del panel de plataforma.
 *
 * El panel es **solo metadatos**: el equipo puede ver el estado, los errores y
 * los contadores de cualquier comercio, pero nunca el contenido de un mensaje
 * ni los datos personales del cliente final (nombre, teléfono, email,
 * dirección). Sí es legítima la identidad del comercio en sí — el dueño de la
 * cuenta Riverz — porque ese es el cliente directo.
 *
 * La regla es POR TABLA: `email` en `profiles` es el comercio (permitido); en
 * `contacts` es el comprador (prohibido). Por eso no sirve una lista global de
 * nombres de columna.
 *
 * `assertMetadataOnly()` se llama en cada consulta de `queries.ts` y hay un
 * test que recorre el módulo, así que agregar una columna prohibida rompe la
 * suite en vez de filtrarse a producción.
 */

/** Columnas que el panel no puede leer, por tabla. */
export const FORBIDDEN_COLUMNS: Record<string, readonly string[]> = {
  messages: ['content_text', 'media_url', 'media_filename'],
  conversations: ['last_message_text', 'ai_summary'],
  contacts: [
    'name',
    'phone',
    'email',
    'company',
    'avatar_url',
    'ai_summary',
    'shopify_customer_data',
    'memory',
    'wa_id',
    'external_id',
  ],
  orders: [
    'customer_name',
    'customer_phone',
    'customer_email',
    'shipping_address',
    'line_items',
    'note',
  ],
  voice_calls: [
    'phone',
    'summary',
    'recording_url',
    'outcome_details',
    'context',
  ],
  webhook_events_raw: ['raw_body', 'headers', 'signature'],
  // Hilos del Operator: lo que un comercio le escribe puede llevar el teléfono
  // de un cliente adentro, y `args`/`result` arrastran lo que devolvió una
  // capacidad. El panel puede contar acciones, no leerlas.
  operator_messages: ['content'],
  operator_actions: ['args', 'result', 'preview'],
  ig_proactive_log: ['text'],
  comment_to_dm_log: ['comment_external_id', 'dm_external_id'],
  automation_logs: ['contact_phone_snapshot', 'contact_name_snapshot'],
  broadcast_recipients: ['contact_phone_snapshot', 'contact_name_snapshot'],
  // Secretos de integración: cifrados, pero no hay razón para sacarlos de la DB.
  channel_connections: ['secrets', 'webhook_secret'],
  ai_agents: ['api_key_encrypted'],
  shopify_connections: [
    'access_token',
    'admin_token',
    'access_token_encrypted',
    'refresh_token',
    'refresh_token_encrypted',
  ],
  workspace_integrations: [
    'credentials',
    'api_key_encrypted',
    'refresh_token_encrypted',
    'access_token_encrypted',
  ],

  // Identidad del comercio, no del comprador: nombre y correo se pueden ver
  // (es a quién se le factura y a quién se le escribe). El teléfono no lo
  // necesita ninguna pantalla del panel, así que no se saca.
  profiles: ['phone'],
  workspaces: [],
  workspace_members: [],
  admin_audit_log: [],
  waitlist: [],

  // Tablas que el panel lee y que no tienen ninguna columna de comprador. Van
  // declaradas igual, con lista vacía: la barrera rechaza lo que no está en
  // este mapa, así que declararlas es la forma de decir "ya la miré".
  ai_replies: [],
  flows: [],
  automations: [],
  shopify_products: [],
  flow_runs: [],
  message_templates: [],
  broadcasts: [],
  cron_runs: [],
  connection_events: [],
  // `args` y `summary` pueden traer el teléfono del comprador o el texto que se
  // le mandó — el MCP ya los guarda ocultos, pero las filas viejas no.
  platform_audit_log: ['args'],
  approval_requests: ['notified_phone', 'payload'],
  dropi_connections: ['api_key', 'password', 'credentials'],
} as const;

/** Limpia un token de `select()`: alias, hints `!inner`, espacios. */
function bare(token: string): string {
  return (token.split(':').pop() ?? token).replace(/!.*$/, '').trim();
}

/**
 * Nombres de columna de un `select()` de PostgREST, incluidas las de dentro de
 * los embeds. Se conservan a propósito: un `contacts(name, phone)` embebido
 * filtra exactamente lo mismo que pedir esas columnas de frente.
 */
export function parseSelectColumns(select: string): string[] {
  return select
    .replace(/[()]/g, ',') // abre los embeds sin perder su contenido
    .split(',')
    .map(bare)
    .filter(Boolean);
}

/** Trocea `tabla(col, col)` para poder validar cada embed contra SU tabla. */
function splitEmbeds(select: string): {
  own: string;
  embeds: { table: string; inner: string }[];
} {
  const embeds: { table: string; inner: string }[] = [];
  let own = "";
  let i = 0;
  while (i < select.length) {
    const open = select.indexOf("(", i);
    if (open === -1) {
      own += select.slice(i);
      break;
    }
    // Nombre del embed: lo que hay entre el separador anterior y el paréntesis.
    const head = select.slice(i, open);
    const sep = Math.max(head.lastIndexOf(","), head.lastIndexOf(" "));
    own += head.slice(0, sep + 1);
    const table = bare(head.slice(sep + 1));

    // Cierre equilibrado — los embeds pueden anidarse.
    let depth = 1;
    let j = open + 1;
    while (j < select.length && depth > 0) {
      if (select[j] === "(") depth++;
      else if (select[j] === ")") depth--;
      j++;
    }
    embeds.push({ table, inner: select.slice(open + 1, j - 1) });
    i = j;
  }
  return { own, embeds };
}

/**
 * Falla ruidosamente si una consulta del panel pide una columna prohibida.
 * Se lanza en vez de recortar en silencio: un panel que muestra de menos se
 * arregla; uno que filtró datos de terceros ya los filtró.
 *
 * Cada embed se valida contra su propia tabla — `email` es del comercio en
 * `profiles` y del comprador en `contacts`, así que la lista correcta depende
 * de dónde salga la columna, no de la consulta que la pidió.
 */
export function assertMetadataOnly(table: string, select: string): void {
  const { own, embeds } = splitEmbeds(select);

  for (const e of embeds) assertMetadataOnly(e.table, e.inner);

  const forbidden = FORBIDDEN_COLUMNS[table];
  // Tabla que nadie declaró: se rechaza en vez de dejarla pasar entera.
  //
  // Antes, una tabla ausente del catálogo salía por acá sin revisar nada —
  // incluido `select('*')`. O sea que la barrera protegía exactamente las
  // catorce tablas que alguien se había acordado de listar, y cualquier tabla
  // nueva nacía sin protección. Declararla con lista vacía es una línea, y
  // obliga a mirar qué columnas tiene antes de leerla desde el panel.
  if (forbidden === undefined) {
    throw new Error(
      `[admin] la tabla "${table}" no está declarada en FORBIDDEN_COLUMNS: agrégala (aunque sea con []) antes de leerla desde el panel.`,
    );
  }

  const asked = own
    .split(",")
    .map(bare)
    .filter(Boolean);

  if (asked.includes("*")) {
    throw new Error(
      `[admin] "select(*)" sobre "${table}" traería columnas prohibidas; enumera las columnas.`,
    );
  }

  if (!forbidden.length) return;

  const hit = asked.find((c) => forbidden.includes(c));
  if (hit) {
    throw new Error(
      `[admin] la consulta sobre "${table}" pide la columna "${hit}", que el panel no puede leer (solo metadatos).`,
    );
  }
}
