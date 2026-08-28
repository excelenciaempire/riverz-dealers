import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentReplyMode } from './dm-opportunity';

export type { CommentReplyMode };

export type ProactiveGate = { ok: boolean; reason?: 'paused' | 'daily_cap' };

const DEFAULT_DAILY_CAP = 500;

/**
 * Trust gate for proactive Instagram DMs: a workspace emergency-pause
 * (kill-switch) + a rolling-24h daily cap (protects sender reputation + Meta
 * rate limits). Checked by the real-time outreach and the batch cron before
 * sending. No settings row → defaults (not paused, 500/day).
 */
export async function proactiveGate(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ProactiveGate> {
  const { data } = await db
    .from('ig_proactive_settings')
    .select('paused, daily_cap')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const s = data as { paused?: boolean; daily_cap?: number } | null;
  return gateFromSettings(db, workspaceId, s);
}

/**
 * Cada funcionalidad se prende y se apaga por su cuenta, como los agentes.
 * Sin fila de ajustes, todo está encendido (el default de las columnas).
 *
 *   comments — responder los comentarios (incluye el piso autónomo).
 *   outreach — salir a buscar: inscribir gente en campañas y enviarles.
 *
 * `paused` (el freno de emergencia) manda sobre las dos y se comprueba aparte,
 * en proactiveGate, junto con el tope diario.
 */
export type IgFeature = 'comments' | 'outreach' | 'marketing_optin';

const FEATURE_COLUMN: Record<IgFeature, string> = {
  comments: 'auto_reply_comments',
  outreach: 'outreach_enabled',
  marketing_optin: 'marketing_optin_enabled',
};

/**
 * `marketing_optin` es el único que arranca APAGADO: los otros dos deciden si
 * el agente contesta, este agrega un mensaje extra que el cliente ve. Por eso
 * su default es false en la columna y acá se lee como false cuando no hay fila.
 */
export async function featureEnabled(
  db: SupabaseClient,
  workspaceId: string,
  feature: IgFeature,
): Promise<boolean> {
  const column = FEATURE_COLUMN[feature];
  const { data } = await db
    .from('ig_proactive_settings')
    .select(column)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const value = (data as Record<string, boolean> | null)?.[column];
  return feature === 'marketing_optin' ? value === true : value !== false;
}

/**
 * Cómo quiere el comercio que la IA conteste los comentarios (migración 132).
 *
 *   audience 'intent' — solo a quien muestra intención de compra (por defecto,
 *                       la conducta de siempre).
 *   audience 'all'    — a todo el que pregunte. El spam se filtra igual.
 *   maxThreadReplies  — cuántas veces puede contestar en el MISMO hilo antes de
 *                       callarse y dejarlo para una persona. 0 = sin tope.
 *
 * Sin fila de ajustes, los defaults reproducen el comportamiento anterior.
 */
export interface CommentReplySettings {
  audience: 'intent' | 'all';
  maxThreadReplies: number;
  /**
   * Qué sale cuando la IA contesta un comentario (migración 177). Una sola
   * decisión en vez de dos interruptores enfrentados:
   *
   *   dm           — solo por privado.
   *   public_dm    — en el comentario y por privado, siempre.
   *   public_smart — en el comentario siempre; por privado solo si hay
   *                  oportunidad o el asunto es privado.
   *   public       — solo en el comentario.
   */
  replyMode: CommentReplyMode;
  /** Además del DM, publicar una respuesta en el propio comentario. */
  publicReply: boolean;
  /** En qué redes trabaja (migraciones 203 y 204). Al menos una encendida. */
  instagram: boolean;
  facebook: boolean;
  /**
   * TikTok no tiene privado —su API de mensajes está cerrada a terceros—, así
   * que ahí la respuesta es SIEMPRE pública, sea cual sea `replyMode`. Y por
   * eso arranca apagado: lo que publica lo lee cualquiera que pase por el video.
   */
  tiktok: boolean;
}

export const COMMENT_REPLY_MODES: CommentReplyMode[] = [
  'dm',
  'public_dm',
  'public_smart',
  'public',
];

export async function loadCommentSettings(
  db: SupabaseClient,
  workspaceId: string,
): Promise<CommentReplySettings> {
  const { data } = await db
    .from('ig_proactive_settings')
    .select(
      'comment_audience, comment_max_thread_replies, comment_public_reply, comment_instagram, comment_facebook, comment_tiktok, comment_reply_mode',
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const s = data as {
    comment_audience?: string | null;
    comment_max_thread_replies?: number | null;
    comment_public_reply?: boolean | null;
    comment_instagram?: boolean | null;
    comment_facebook?: boolean | null;
    comment_tiktok?: boolean | null;
    comment_reply_mode?: string | null;
  } | null;
  // Sin modo guardado (fila vieja, migración sin aplicar) se deriva del
  // interruptor anterior: nadie cambia de conducta por leer una columna nueva.
  const replyMode = COMMENT_REPLY_MODES.includes(
    s?.comment_reply_mode as CommentReplyMode,
  )
    ? (s?.comment_reply_mode as CommentReplyMode)
    : s?.comment_public_reply === true
      ? 'public_dm'
      : 'dm';
  return {
    audience: s?.comment_audience === 'all' ? 'all' : 'intent',
    maxThreadReplies:
      typeof s?.comment_max_thread_replies === 'number'
        ? Math.max(0, s.comment_max_thread_replies)
        : 3,
    replyMode,
    // 'dm' es el único modo que no publica nada bajo el post.
    publicReply: replyMode !== 'dm',
    // Sin fila de ajustes (o con la migración 203 sin aplicar) trabaja en
    // Instagram, que es lo que hacía antes de que la pregunta existiera.
    instagram: s?.comment_instagram !== false,
    facebook: s?.comment_facebook === true,
    tiktok: s?.comment_tiktok === true,
  };
}

/**
 * GUARDAR ESOS AJUSTES.
 *
 * Vivía inline dentro de `POST /api/ai/instagram-agent/settings`, así que sólo
 * existía para quien tuviera la pantalla abierta. El Operador podía LEER cómo
 * contesta la IA en comentarios —`comentarios.pendientes` lo dice— y no podía
 * cambiarlo, que es justo lo que hace falta cuando la IA está contestando mal.
 *
 * La validación va acá y no en cada llamador porque no es cosmética: hay un
 * CHECK en la base sobre `comment_audience` y `comment_reply_mode`, un rango en
 * los dos topes, y la regla de que nunca quedan las tres redes apagadas —sin
 * ella "Responder con IA" queda encendido sin poder contestar en ningún lado—.
 * Un valor desconocido se IGNORA en vez de guardarse: es preferible que un
 * campo no cambie a que la fila entera se rechace.
 */
export interface AjustesDeComentarios {
  paused?: unknown;
  daily_cap?: unknown;
  auto_reply_comments?: unknown;
  outreach_enabled?: unknown;
  comment_audience?: unknown;
  comment_max_thread_replies?: unknown;
  comment_public_reply?: unknown;
  comment_instagram?: unknown;
  comment_facebook?: unknown;
  comment_tiktok?: unknown;
  comment_reply_mode?: unknown;
  marketing_optin_enabled?: unknown;
}

/** ¿El cuerpo trae algo que guardar? Sin esto se escribiría una fila vacía. */
export function hayAjustesQueGuardar(body: AjustesDeComentarios): boolean {
  return Object.keys(construirParche(body)).length > 0;
}

/**
 * El parche listo para la base, sin el `workspace_id`. Puro: se puede probar
 * sin tocar la red, que es donde vive el riesgo de esta función.
 */
export function construirParche(
  body: AjustesDeComentarios,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  // A quién le contesta la IA (migración 132).
  if (body.comment_audience === 'intent' || body.comment_audience === 'all') {
    patch.comment_audience = body.comment_audience;
  }
  if (typeof body.comment_public_reply === 'boolean') {
    patch.comment_public_reply = body.comment_public_reply;
  }
  // Las redes se guardan juntas y nunca todas apagadas. La pantalla lo hace
  // imposible; acá se protege igual, porque el chat no tiene esa pantalla.
  if (
    typeof body.comment_instagram === 'boolean' ||
    typeof body.comment_facebook === 'boolean' ||
    typeof body.comment_tiktok === 'boolean'
  ) {
    const fb = body.comment_facebook === true;
    const tt = body.comment_tiktok === true;
    const ig = body.comment_instagram === true;
    patch.comment_instagram = ig || (!fb && !tt);
    patch.comment_facebook = fb;
    patch.comment_tiktok = tt;
  }
  if (COMMENT_REPLY_MODES.includes(body.comment_reply_mode as CommentReplyMode)) {
    patch.comment_reply_mode = body.comment_reply_mode;
    // El interruptor viejo se sigue escribiendo: si algún día se lee esa
    // columna otra vez, dice lo mismo que el modo.
    patch.comment_public_reply = body.comment_reply_mode !== 'dm';
  }
  if (typeof body.marketing_optin_enabled === 'boolean') {
    patch.marketing_optin_enabled = body.marketing_optin_enabled;
  }
  if (body.comment_max_thread_replies != null) {
    patch.comment_max_thread_replies = Math.max(
      0,
      Math.min(10, Math.round(Number(body.comment_max_thread_replies)) || 0),
    );
  }
  if (typeof body.paused === 'boolean') patch.paused = body.paused;
  if (typeof body.auto_reply_comments === 'boolean') {
    patch.auto_reply_comments = body.auto_reply_comments;
  }
  if (typeof body.outreach_enabled === 'boolean') {
    patch.outreach_enabled = body.outreach_enabled;
  }
  if (body.daily_cap != null) {
    patch.daily_cap = Math.max(
      0,
      Math.min(10000, Math.round(Number(body.daily_cap)) || 0),
    );
  }
  return patch;
}

/** Guarda el parche. Lanza con el mensaje de la base si no se pudo. */
export async function guardarAjustesDeComentarios(
  db: SupabaseClient,
  workspaceId: string,
  body: AjustesDeComentarios,
): Promise<Record<string, unknown>> {
  const patch = construirParche(body);
  if (Object.keys(patch).length === 0) return {};
  const { error } = await db
    .from('ig_proactive_settings')
    .upsert({ workspace_id: workspaceId, ...patch }, { onConflict: 'workspace_id' });
  if (error) throw new Error(error.message);
  return patch;
}

/** ¿Está encendido el piso autónomo (responder comentarios sin campaña)? */
export async function autoReplyCommentsEnabled(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  return featureEnabled(db, workspaceId, 'comments');
}

async function gateFromSettings(
  db: SupabaseClient,
  workspaceId: string,
  s: { paused?: boolean; daily_cap?: number } | null,
): Promise<ProactiveGate> {
  if (s?.paused) return { ok: false, reason: 'paused' };
  const cap = s?.daily_cap ?? DEFAULT_DAILY_CAP;
  if (cap <= 0) return { ok: true }; // 0 = unlimited
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // El tope protege la reputación de ENVÍO de la cuenta, así que cuenta DMs.
  // Una respuesta pública en un comentario no es un DM: si contara, publicar
  // en público consumiría el presupuesto de los privados.
  const { count } = await db
    .from('ig_proactive_log')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .neq('kind', 'comment_public')
    .gte('created_at', since);
  if ((count ?? 0) >= cap) return { ok: false, reason: 'daily_cap' };
  return { ok: true };
}

/**
 * Append one audit-log row per proactive DM. Best-effort; never throws.
 *
 * `kind` dice QUIÉN mandó el DM, y de ahí salen las cifras de cada pantalla:
 *
 *   outreach | batch | closer | approval — Prospección IA (campañas).
 *   comment                              — Comentarios: DM de la IA.
 *   comment_rule                         — Comentarios: DM de una regla.
 *   comment_public                       — Comentarios: respuesta PÚBLICA en el
 *                                          propio comentario (no es un DM y no
 *                                          cuenta para el tope).
 *
 * Las reglas llevan además su propio libro (`comment_to_dm_log`, con el estado
 * de la respuesta pública); aquí entran solo para que cuenten en el tope
 * diario, porque el límite protege la reputación de la cuenta y le da igual
 * qué funcionalidad mandó el DM.
 *
 * Las estadísticas nunca mezclan los kinds.
 */
export async function logProactiveSend(
  db: SupabaseClient,
  row: {
    workspaceId: string;
    campaignId?: string | null;
    contactId?: string | null;
    kind:
      | 'outreach'
      | 'batch'
      | 'closer'
      | 'approval'
      | 'comment'
      | 'comment_rule'
      | 'comment_public'
      /** Pedido de permiso de Marketing Messages (llena la lista de suscriptores). */
      | 'optin';
    text?: string | null;
  },
): Promise<void> {
  await db
    .from('ig_proactive_log')
    .insert({
      workspace_id: row.workspaceId,
      campaign_id: row.campaignId ?? null,
      contact_id: row.contactId ?? null,
      kind: row.kind,
      text: (row.text ?? '').slice(0, 1000) || null,
    })
    .then(
      () => {},
      () => {},
    );
}
