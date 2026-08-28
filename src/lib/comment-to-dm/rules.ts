import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/**
 * Las reglas comentario → DM, guardadas y leídas en un solo lugar.
 *
 * Vivían dentro de `/api/comment-to-dm/route.ts`, así que sólo existían para el
 * navegador: cualquier otro camino que quisiera leer o crear una regla —el chat
 * agéntico, el MCP— tenía que volver a escribir la normalización de campos, y
 * dos normalizaciones distintas guardan filas distintas para el mismo pedido
 * (un `post_id` en blanco que queda como cadena vacía en vez de NULL deja la
 * regla mirando una publicación que no existe, y no vuelve a disparar nunca).
 *
 * Quien manda sigue siendo el motor (`engine.ts`): esto sólo guarda lo que el
 * motor después lee.
 */

/**
 * Dónde escucha una regla: una red, o las dos de Meta (migraciones 203 y 204).
 *
 * 'both' es Instagram + Facebook y no incluye TikTok a propósito: esas dos
 * comparten el mecanismo del privado y TikTok no lo tiene, así que una regla
 * escrita para las dos no se puede ejecutar igual en la tercera.
 */
export type CommentRuleChannel =
  | 'ig_comment'
  | 'fb_comment'
  | 'both'
  | 'tiktok_comment';

const RULE_CHANNELS: CommentRuleChannel[] = [
  'ig_comment',
  'fb_comment',
  'both',
  'tiktok_comment',
];

/** ¿Esta regla vive en una red sin mensajes privados? */
export function reglaSinPrivado(channel: unknown): boolean {
  return channel === 'tiktok_comment';
}

/** Lo que se devuelve hacia afuera. Nunca `workspace_id` ni `created_by`. */
export const RULE_COLUMNS =
  'id, name, channel, post_id, keywords, match_type, case_sensitive, public_reply_enabled, public_reply_templates, dm_message, dm_button_label, dm_button_url, dm_attachment_url, dm_attachment_type, is_active, priority, created_at';

export interface CommentRule {
  id: string;
  name: string;
  channel: CommentRuleChannel;
  post_id: string | null;
  keywords: string[];
  match_type: 'contains' | 'exact';
  case_sensitive: boolean;
  public_reply_enabled: boolean;
  public_reply_templates: string[];
  dm_message: string;
  dm_button_label: string | null;
  dm_button_url: string | null;
  /** Un recurso que acompaña al DM: catálogo en PDF, cupón en imagen, video. */
  dm_attachment_url: string | null;
  dm_attachment_type: CommentRuleAttachmentType | null;
  is_active: boolean;
  priority: number;
  created_at: string;
}

/** Lo que Meta acepta como adjunto en un DM (migración 177). */
export type CommentRuleAttachmentType = 'image' | 'video' | 'audio' | 'file';

const ATTACHMENT_TYPES: CommentRuleAttachmentType[] = [
  'image',
  'video',
  'audio',
  'file',
];

/**
 * El tipo del recurso. Si no lo mandan, se deduce de la extensión: nadie que
 * pega el enlace de su catálogo debería tener que elegir "archivo" en un menú.
 */
export function attachmentTypeFor(
  url: string | null,
  declared?: unknown,
): CommentRuleAttachmentType | null {
  if (!url) return null;
  if (ATTACHMENT_TYPES.includes(declared as CommentRuleAttachmentType)) {
    return declared as CommentRuleAttachmentType;
  }
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(jpe?g|png|gif|webp)$/.test(clean)) return 'image';
  if (/\.(mp4|mov|webm)$/.test(clean)) return 'video';
  if (/\.(mp3|ogg|m4a|wav)$/.test(clean)) return 'audio';
  return 'file';
}

/**
 * Una regla con lo que hizo: DMs entregados y DMs que Meta rechazó. Los fallos
 * se cuentan aparte a propósito — una regla que dispara y nunca entrega se veía
 * exactamente igual que una regla que nadie activó nunca.
 */
export type CommentRuleWithCount = CommentRule & {
  dm_sent_count: number;
  dm_failed_count: number;
};

/** Lo que llega de afuera: del formulario, del chat o del MCP. */
export interface CommentRuleInput {
  name?: string;
  channel?: string;
  post_id?: string | null;
  keywords?: unknown;
  match_type?: string;
  case_sensitive?: boolean;
  public_reply_enabled?: boolean;
  public_reply_templates?: unknown;
  dm_message?: string;
  dm_button_label?: string | null;
  dm_button_url?: string | null;
  dm_attachment_url?: string | null;
  dm_attachment_type?: unknown;
  is_active?: boolean;
  priority?: number;
}

/** Lo mismo, ya listo para el INSERT/UPDATE. */
export type CommentRuleFields = Omit<CommentRule, 'id' | 'created_at'>;

export function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
}

/**
 * ¿Alcanza para guardar una regla?
 *
 * Sin nombre no se distingue de las otras y sin canal no se sabe dónde escucha.
 * Lo tercero depende de la red: en Instagram y Facebook una regla existe para
 * mandar un privado, así que el DM es obligatorio; en TikTok no hay privado, y
 * lo que no puede faltar es la respuesta que se publica bajo el video —una
 * regla de TikTok sin eso no haría absolutamente nada.
 */
export function isCompleteRuleInput(input: CommentRuleInput | null): boolean {
  if (!input) return false;
  if (!input.name?.trim()) return false;
  if (!RULE_CHANNELS.includes(input.channel as CommentRuleChannel)) return false;
  return reglaSinPrivado(input.channel)
    ? cleanStrings(input.public_reply_templates).length > 0
    : Boolean(input.dm_message?.trim());
}

/**
 * Texto vacío ⇒ NULL, no cadena vacía.
 *
 * El motor pregunta `post_id == null` para saber si la regla vale para
 * cualquier publicación; una cadena vacía pasa esa comprobación como si fuera
 * un id concreto y la regla deja de disparar en silencio.
 */
function nullIfBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function ruleFields(input: CommentRuleInput): CommentRuleFields {
  // Sin ninguna respuesta escrita no hay nada que publicar: la regla se guarda
  // como "solo DM" en vez de quedar encendida y no publicar nunca. El estado
  // "publica en el comentario" con la caja vacía era una promesa vacía — la
  // lista lo anunciaba y el motor lo saltaba en silencio.
  const publicReplies = cleanStrings(input.public_reply_templates);
  // En TikTok no hay privado: lo que se escriba en los campos del DM no se
  // podría mandar, así que no se guarda y la regla no promete nada que no
  // vaya a pasar. `dm_message` es NOT NULL en la BD, de ahí la cadena vacía.
  const sinPrivado = reglaSinPrivado(input.channel);
  return {
    name: (input.name ?? '').trim(),
    channel: input.channel as CommentRuleChannel,
    post_id: nullIfBlank(input.post_id),
    keywords: cleanStrings(input.keywords),
    match_type: input.match_type === 'exact' ? 'exact' : 'contains',
    case_sensitive: Boolean(input.case_sensitive),
    public_reply_enabled: (input.public_reply_enabled ?? true) && publicReplies.length > 0,
    public_reply_templates: publicReplies,
    dm_message: sinPrivado ? '' : (input.dm_message ?? '').trim(),
    dm_button_label: sinPrivado ? null : nullIfBlank(input.dm_button_label),
    dm_button_url: sinPrivado ? null : nullIfBlank(input.dm_button_url),
    dm_attachment_url: sinPrivado ? null : nullIfBlank(input.dm_attachment_url),
    dm_attachment_type: sinPrivado
      ? null
      : attachmentTypeFor(
          nullIfBlank(input.dm_attachment_url),
          input.dm_attachment_type,
        ),
    is_active: input.is_active ?? true,
    priority: typeof input.priority === 'number' ? input.priority : 100,
  };
}

/**
 * El texto exacto que recibe la persona.
 *
 * La respuesta privada de Meta es sólo texto —no admite botones—, así que el
 * botón se pega abajo como enlace con su etiqueta. Vive acá y no dentro del
 * motor porque lo que se le muestra a quien aprueba una regla tiene que ser
 * literalmente lo que se va a enviar: dos versiones del mismo armado son dos
 * mensajes distintos, y el que se aprueba no es el que sale.
 */
export function composeDmText(rule: {
  dm_message: string;
  dm_button_label?: string | null;
  dm_button_url?: string | null;
}): string {
  const parts = [rule.dm_message.trim()];
  const url = rule.dm_button_url?.trim();
  if (url) {
    const label = rule.dm_button_label?.trim();
    parts.push(label ? `👉 ${label}: ${url}` : url);
  }
  return parts.join('\n\n');
}

/**
 * Las reglas de una cuenta, con cuántos DMs mandó cada una.
 *
 * `workspaceId` puede venir en null: por el camino del navegador la sesión ya
 * recorta por RLS y la pantalla pide todas las que ve. Los caminos sin sesión
 * (chat, MCP) SIEMPRE pasan la cuenta — ahí el cliente es de servicio y sin el
 * filtro se leerían reglas ajenas.
 */
export async function listRulesWithCounts(
  db: SupabaseClient,
  workspaceId: string | null,
): Promise<{ rules: CommentRuleWithCount[]; error: PostgrestError | null }> {
  let query = db
    .from('comment_to_dm_rules')
    .select(RULE_COLUMNS)
    .order('priority', { ascending: true });
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { data, error } = await query;
  if (error) return { rules: [], error };

  // Los envíos salen del log en UNA consulta: contarlos por regla, de a una,
  // era una consulta por fila de la tabla.
  const list = (data ?? []) as unknown as CommentRule[];
  const ruleIds = list.map((r) => r.id);
  const sent: Record<string, number> = {};
  const failed: Record<string, number> = {};
  if (ruleIds.length > 0) {
    const { data: logs } = await db
      .from('comment_to_dm_log')
      .select('rule_id, dm_status')
      .in('rule_id', ruleIds)
      .in('dm_status', ['sent', 'failed']);
    for (const row of (logs ?? []) as {
      rule_id: string;
      dm_status: string;
    }[]) {
      const bucket = row.dm_status === 'failed' ? failed : sent;
      bucket[row.rule_id] = (bucket[row.rule_id] ?? 0) + 1;
    }
  }
  return {
    rules: list.map((r) => ({
      ...r,
      dm_sent_count: sent[r.id] ?? 0,
      dm_failed_count: failed[r.id] ?? 0,
    })),
    error: null,
  };
}

export async function getRule(
  db: SupabaseClient,
  args: { id: string; workspaceId: string },
): Promise<CommentRule | null> {
  const { data } = await db
    .from('comment_to_dm_rules')
    .select(RULE_COLUMNS)
    .eq('id', args.id)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle();
  return (data as unknown as CommentRule) ?? null;
}

export async function createRule(
  db: SupabaseClient,
  args: { workspaceId: string; createdBy: string | null; fields: CommentRuleFields },
): Promise<{ rule: { id: string } | null; error: PostgrestError | null }> {
  const { data, error } = await db
    .from('comment_to_dm_rules')
    .insert({
      workspace_id: args.workspaceId,
      created_by: args.createdBy,
      ...args.fields,
    })
    .select('id')
    .single();
  return { rule: (data as { id: string } | null) ?? null, error };
}

export async function updateRule(
  db: SupabaseClient,
  args: { id: string; workspaceId: string; fields: CommentRuleFields },
): Promise<{ error: PostgrestError | null }> {
  const { error } = await db
    .from('comment_to_dm_rules')
    .update({ ...args.fields, updated_at: new Date().toISOString() })
    .eq('id', args.id)
    .eq('workspace_id', args.workspaceId);
  return { error };
}

export async function deleteRule(
  db: SupabaseClient,
  args: { id: string; workspaceId: string },
): Promise<{ error: PostgrestError | null }> {
  const { error } = await db
    .from('comment_to_dm_rules')
    .delete()
    .eq('id', args.id)
    .eq('workspace_id', args.workspaceId);
  return { error };
}

/**
 * Prender o apagar, sin tocar nada más.
 *
 * Aparte del alta/edición a propósito: el formulario manda la regla entera y
 * eso está bien cuando alguien la está editando, pero "prendé la regla del
 * sorteo" no debería poder reescribir de paso el texto del DM.
 */
export async function setRuleActive(
  db: SupabaseClient,
  args: { id: string; workspaceId: string; active: boolean },
): Promise<CommentRule> {
  const { data, error } = await db
    .from('comment_to_dm_rules')
    .update({ is_active: args.active, updated_at: new Date().toISOString() })
    .eq('id', args.id)
    .eq('workspace_id', args.workspaceId)
    .select(RULE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('esa regla no existe en esta cuenta');
  return data as unknown as CommentRule;
}
