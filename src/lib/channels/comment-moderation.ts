import type { ChannelConnection } from '@/types';
import { decrypt } from './encryption';
import { withAppsecretProofBody } from './meta-graph';
import { pistaDeModeracion } from './meta-errors';
import { findMessageByExternalId } from './message-lookup';
import { supabaseAdmin } from './admin-client';
import { puedeUsarIa } from '@/lib/wallet/puerta';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Hide (or unhide) a comment on the merchant's OWN Instagram/Facebook post via
 * Meta's SANCTIONED moderation API — the official way, not a scrape and not
 * only the native fan-page UI. Instagram uses the `hide` field; Facebook uses
 * `is_hidden` (they are NOT interchangeable — sending the wrong one is silently
 * ignored by Graph, so the call 200s without hiding anything).
 *
 * Permissions: Instagram needs `instagram_manage_comments` (Advanced Access /
 * App Review — already submitted); Facebook needs `pages_manage_engagement`
 * (no App Review). If the permission isn't granted yet, Meta returns an error
 * and we simply return false — we do NOT flag the connection as broken
 * (messaging still works), so moderation degrades gracefully until App Review
 * clears. Best-effort: never throws.
 */
export async function setCommentHidden(
  connection: ChannelConnection,
  channel: 'ig_comment' | 'fb_comment',
  commentId: string,
  hidden = true,
  /** Por qué lo oculta la IA. Queda escrito en la fila: sin esto, "lo ocultó
   *  Riverz o lo ocultamos nosotros" no se puede contestar. */
  motivo: string | null = null,
): Promise<boolean> {
  // This helper is the AI path, not the inbox's manual moderation endpoint.
  // Recheck at the side-effect boundary, including work queued before payment expired.
  if (!(await puedeUsarIa(supabaseAdmin(), connection.workspace_id))) return false;
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? '');
  if (!enc || !commentId) return false;
  const token = decrypt(enc);
  const param =
    channel === 'ig_comment' ? { hide: hidden } : { is_hidden: hidden };
  try {
    const res = await fetch(`${GRAPH}/${commentId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        withAppsecretProofBody({ ...param, access_token: token }, token),
      ),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      await anotarOculto(connection, channel, commentId, hidden, motivo);
      return true;
    }
    // ¿Falló, o ya estaba así?
    //
    // Facebook rechaza pedirle ocultar un comentario que YA está oculto, y lo
    // hace con `#1 An unknown error occurred` — el mismo código que usa para
    // todo lo demás. Verificado el 2026-08-30 sobre un comentario real:
    // `unhide` 200, `hide` 200, y `hide` sobre uno ya oculto, #1.
    //
    // Sin esta comprobación, un estado que YA es el que queríamos se registra
    // como fallo: escribe `last_error`, escala el comentario a una persona y
    // manda a revisar permisos que están bien. Se pregunta el estado real en
    // vez de adivinar qué significa el #1.
    if (await yaEstaAsi(token, channel, commentId, hidden)) {
      await anotarOculto(connection, channel, commentId, hidden, motivo);
      return true;
    }
    await anotarFalloDeModeracion(connection, channel, res);
    return false;
  } catch (err) {
    await anotarFalloDeModeracion(
      connection,
      channel,
      null,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * ¿El comentario ya está como lo queríamos dejar?
 *
 * Se pregunta DESPUÉS de que la escritura falló, para separar "no se pudo" de
 * "no hacía falta". Facebook las devuelve iguales: un `#1` genérico tanto si
 * falta un permiso como si el comentario ya estaba oculto.
 *
 * Los campos son distintos por red y no son intercambiables: Facebook expone
 * `is_hidden` e Instagram `hidden`. Ante cualquier duda —la lectura falla, el
 * campo no viene— devuelve `false`: preferimos avisar de más que dar por hecho
 * un ocultado que no pasó.
 */
export async function yaEstaAsi(
  token: string,
  channel: 'ig_comment' | 'fb_comment',
  commentId: string,
  deseado: boolean,
): Promise<boolean> {
  const campo = channel === 'ig_comment' ? 'hidden' : 'is_hidden';
  try {
    const url =
      `${GRAPH}/${commentId}?fields=${campo}` +
      `&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return false;
    const j = (await r.json()) as Record<string, unknown>;
    return j[campo] === deseado;
  } catch {
    return false;
  }
}

/**
 * QUÉ dijo Meta cuando no dejó moderar.
 *
 * Antes esto era un `return false` a secas: si a la cuenta le falta
 * `pages_manage_engagement`, ocultar falla en TODOS los comentarios, para
 * siempre, y no queda una sola línea en ningún lado. Facebook llevaba dos meses
 * así — ni una respuesta ni un ocultado de la IA, y cero errores registrados
 * (visto el 2026-08-30). Un permiso que falta es un arreglo de dos minutos en
 * el panel de Meta; lo caro es no enterarse.
 *
 * Queda en `channel_connections.last_error`, que es lo que mira el panel de
 * canales, y en el log con el cuerpo entero de Graph.
 */
async function anotarFalloDeModeracion(
  connection: ChannelConnection,
  channel: 'ig_comment' | 'fb_comment',
  res: Response | null,
  motivo?: string,
): Promise<void> {
  let detalle = motivo ?? `HTTP ${res?.status ?? '?'}`;
  try {
    if (res) {
      const cuerpo = await res.text();
      const j = JSON.parse(cuerpo) as { error?: { message?: string; code?: number } };
      if (j.error?.message) {
        detalle = `#${j.error.code ?? '?'} ${j.error.message}`;
        const pista = pistaDeModeracion(channel, j.error.code);
        if (pista) detalle += ` · ${pista}`;
      } else if (cuerpo.trim()) {
        detalle = cuerpo.trim().slice(0, 300);
      }
    }
  } catch {
    /* el cuerpo no era JSON: sirve lo que ya se armó */
  }
  const texto = `no se pudo moderar el comentario (${channel}): ${detalle}`.slice(0, 500);
  console.error('[comments]', texto);
  try {
    const { supabaseAdmin } = await import('@/lib/automations/admin-client');
    await supabaseAdmin()
      .from('channel_connections')
      .update({ last_error: texto })
      .eq('id', connection.id);
  } catch (err) {
    console.error('[comments] no se pudo anotar el fallo de moderación:', err);
  }
}

/**
 * Deja el estado escrito también de este lado.
 *
 * Sin esto, ocultar por acá —lo que hace el agente de Instagram con el spam—
 * cambiaba el comentario en la red y no en la bandeja: el comercio veía el
 * comentario como visible hasta que el cron de conciliación pasara, hasta diez
 * minutos después. La fila se busca por el id de Meta, que es el mismo que
 * viaja en `messages.message_id`.
 *
 * Best-effort igual que el resto: si no se puede escribir, el cron lo corrige.
 */
async function anotarOculto(
  connection: ChannelConnection,
  channel: 'ig_comment' | 'fb_comment',
  commentId: string,
  hidden: boolean,
  motivo: string | null,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/lib/automations/admin-client');
    const db = supabaseAdmin();
    // La fila de ESTE comercio. Antes se escribía por el id de Meta a secas:
    // la misma cuenta conectada en dos workspaces se ocultaba en los dos.
    const fila = await findMessageByExternalId(db, {
      workspaceId: connection.workspace_id,
      channel,
      externalMessageId: commentId,
    });
    if (!fila) return;
    await db
      .from('messages')
      .update(
        hidden
          ? {
              is_hidden: true,
              hidden_by: 'ia',
              hidden_reason: motivo,
              hidden_at: new Date().toISOString(),
            }
          : {
              is_hidden: false,
              hidden_by: null,
              hidden_by_user_id: null,
              hidden_reason: null,
              hidden_at: null,
            },
      )
      .eq('id', fila.id);
  } catch (err) {
    console.error('[comments] no se pudo anotar el ocultado:', commentId, err);
  }
}
