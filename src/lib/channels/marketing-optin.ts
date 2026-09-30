/**
 * Marketing Messages de Meta — pedir el permiso, guardarlo y gastarlo.
 *
 * El problema que resuelve: Meta sólo deja escribirle a alguien dentro de una
 * ventana corta (24 h desde su último DM, 7 días desde su comentario). Fuera de
 * ahí, silencio. Eso dejaba a las campañas hablándole a las pocas personas que
 * habían interactuado esta semana — y encima a las mismas que Comentarios ya
 * había contestado.
 *
 * Marketing Messages es la salida oficial: DENTRO de la ventana se le manda a
 * la persona una plantilla `notification_messages` pidiéndole permiso; si
 * acepta, Meta devuelve por webhook un `notification_messages_token` con el que
 * se le puede escribir indefinidamente, fuera de toda ventana, con un tope de
 * un mensaje cada 48 h.
 *
 * Tres piezas, en el orden en que ocurren:
 *   1. `requestOptIn`    — pedirlo mientras ya estamos conversando.
 *   2. `recordOptIn`     — guardarlo cuando la persona acepta (webhook).
 *   3. `sendToSubscriber`— usarlo, respetando el tope de 48 h.
 *
 * Lo que NO hace: pedirle permiso a alguien que no nos escribió nunca. El
 * pedido es en sí un mensaje, así que vive bajo las mismas reglas de ventana
 * que todo lo demás.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from './encryption';
import { withAppsecretProofBody } from './meta-graph';
import { describeMetaSendError, parseMetaError } from './meta-errors';
import { assertWorkspaceWritable } from '@/lib/billing/read-only';
import { assertRecoveryStillUnanswered } from '@/lib/billing/recovery-send-guard';

const GRAPH = 'https://graph.facebook.com/v22.0';

/** Tope duro de Meta: un mensaje de marketing cada 48 h por suscriptor. */
export const MARKETING_COOLDOWN_MS = 48 * 60 * 60 * 1000;

/**
 * Tema único por workspace, por ahora.
 *
 * Meta permite hasta 10 temas por persona en 7 días, pero cada tema es una
 * lista separada que hay que llenar y mantener: con uno solo, todo el que
 * acepta entra a la misma lista y las campañas tienen a quién escribirle desde
 * el primer día. Se puede abrir a varios cuando exista la necesidad real.
 */
export const DEFAULT_OPTIN_TITLE = 'Ofertas y novedades';

export type OptinChannel = 'instagram' | 'messenger';

export interface MarketingOptin {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  connection_id: string | null;
  channel: OptinChannel;
  external_contact_id: string;
  notification_messages_token: string;
  token_expiry_timestamp: string | null;
  title: string;
  status: 'active' | 'expired' | 'revoked';
  last_sent_at: string | null;
  next_eligible_at: string | null;
  sent_count: number;
}

/** El evento `optin` tal como llega en `entry.messaging[]`. */
export interface MetaOptinEvent {
  type?: string;
  payload?: string;
  notification_messages_token?: string;
  token_expiry_timestamp?: number | string;
  user_token_status?: string;
  notification_messages_status?: string;
  title?: string;
}

/** ¿Este evento del webhook es de Marketing Messages (alta O baja)? */
export function isMarketingOptin(optin: unknown): optin is MetaOptinEvent {
  const o = optin as MetaOptinEvent | null;
  return Boolean(
    o &&
      typeof o === 'object' &&
      o.type === 'notification_messages' &&
      o.notification_messages_token,
  );
}

/**
 * ¿La persona pidió DEJAR de recibir?
 *
 * Meta manda el "Stop these messages" por el MISMO webhook y con el token
 * adentro, distinguiéndolo sólo por `notification_messages_status`. Leer nada
 * más el token y guardar 'active' convertía una baja en un alta: la persona
 * apretaba "no quiero más" y le seguíamos mandando marketing. Es lo único de
 * esta funcionalidad que no es un bug sino un problema de cumplimiento.
 */
export function isOptOutEvent(optin: MetaOptinEvent): boolean {
  const status = String(
    optin.notification_messages_status ?? optin.user_token_status ?? '',
  ).toUpperCase();
  return status.includes('STOP') || status.includes('REVOK');
}

/** Meta manda el vencimiento en segundos epoch; a veces como string. */
function expiryToIso(value: number | string | undefined): string | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Segundos si es de 10 dígitos, milisegundos si es de 13.
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/**
 * Guardar (o renovar) el permiso que acaba de dar una persona.
 *
 * Idempotente por (conexión, persona, tema): Meta reenvía el webhook y también
 * emite un token nuevo cuando alguien renueva, así que la fila se actualiza en
 * lugar de duplicarse. Un `status` previo de 'revoked' vuelve a 'active': que
 * alguien se haya bajado antes no le impide volver a suscribirse.
 */
export async function recordOptIn(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    connectionId: string | null;
    channel: OptinChannel;
    externalContactId: string;
    contactId?: string | null;
    optin: MetaOptinEvent;
  },
): Promise<void> {
  const token = input.optin.notification_messages_token;
  if (!token) return;

  // Atar el permiso al contacto de Riverz, no sólo al id de Meta.
  //
  // Los webhooks traen el IGSID/PSID y nada más, así que sin esta búsqueda la
  // columna quedaba SIEMPRE en null — y como la audiencia de campaña se arma
  // por contacto, la lista entera resultaba invisible: el contador de la
  // pantalla mostraba suscriptores y ninguna campaña encolaba uno solo.
  let contactId = input.contactId ?? null;
  if (!contactId) {
    const { data: c } = await db
      .from('contacts')
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('external_id', input.externalContactId)
      .limit(1)
      .maybeSingle();
    contactId = (c as { id?: string } | null)?.id ?? null;
  }

  const row: Record<string, unknown> = {
    workspace_id: input.workspaceId,
    connection_id: input.connectionId,
    channel: input.channel,
    external_contact_id: input.externalContactId,
    notification_messages_token: token,
    token_expiry_timestamp: expiryToIso(input.optin.token_expiry_timestamp),
    title: (input.optin.title || DEFAULT_OPTIN_TITLE).slice(0, 65),
    // Alta o baja: las dos llegan por acá y sólo las separa este campo.
    status: isOptOutEvent(input.optin) ? ('revoked' as const) : ('active' as const),
    updated_at: new Date().toISOString(),
  };
  // Sólo se pisa si lo pudimos resolver: un webhook que llega antes de que
  // exista el contacto no debe borrar el vínculo que otro ya estableció.
  if (contactId) row.contact_id = contactId;

  // `next_eligible_at` NO se toca a propósito. Este upsert es también el
  // camino de RENOVACIÓN del token, y resetearlo ahí borraba un cooldown de
  // 48 h en curso: la campaña la daba por contactable, Meta rechazaba por
  // tope, y el rechazo la marcaba revocada para siempre. En una fila nueva la
  // columna ya nace en null, que es lo que se quería.

  const { error } = await db
    .from('meta_marketing_optins')
    .upsert(row, { onConflict: 'connection_id,external_contact_id,title' });
  if (error) console.error('[marketing-optin] no se pudo guardar el opt-in:', error);
}

/**
 * ¿Ya le pedimos permiso a esta persona?
 *
 * Meta tolera hasta 10 pedidos por persona en 7 días, pero el límite que
 * importa es el otro: cada pedido es un mensaje que el cliente ve. Uno por
 * persona y tema — si dijo que no, no se vuelve a insistir.
 */
async function alreadyAsked(
  db: SupabaseClient,
  connectionId: string | null,
  externalContactId: string,
  title: string,
): Promise<boolean> {
  const { count } = await db
    .from('meta_marketing_optins')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .eq('external_contact_id', externalContactId)
    .eq('title', title);
  if ((count ?? 0) > 0) return true;

  // Un pedido que la persona nunca respondió no deja fila (sólo la aceptación
  // dispara webhook), así que el registro de envíos proactivos es lo único que
  // sabe que ya se le preguntó.
  const { count: asked } = await db
    .from('ig_proactive_log')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'optin')
    .eq('text', externalContactId);
  return (asked ?? 0) > 0;
}

/**
 * Pedirle a la persona que acepte recibir novedades, aprovechando que la
 * ventana está abierta ahora mismo.
 *
 * Devuelve true sólo si Meta aceptó el pedido. Nunca lanza: esto corre pegado
 * a una respuesta que ya se envió con éxito, y fallar acá no puede tumbar la
 * conversación.
 */
export async function requestOptIn(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    connectionId: string | null;
    channel: OptinChannel;
    externalContactId: string;
    /** Page/IG id que envía, con su token de acceso cifrado. */
    senderId: string;
    accessTokenEncrypted: string;
    title?: string;
  },
): Promise<boolean> {
  const title = (input.title || DEFAULT_OPTIN_TITLE).slice(0, 65);
  try {
    if (await alreadyAsked(db, input.connectionId, input.externalContactId, title)) {
      return false;
    }

    const accessToken = decrypt(input.accessTokenEncrypted);
    if (!accessToken) return false;
    await assertWorkspaceWritable(db,input.workspaceId);
    await assertRecoveryStillUnanswered(db,'');

    const res = await fetch(`${GRAPH}/${input.senderId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        withAppsecretProofBody(
          {
            recipient: { id: input.externalContactId },
            message: {
              attachment: {
                type: 'template',
                payload: {
                  template_type: 'notification_messages',
                  title,
                  notification_messages_cta_text: 'OPT_IN',
                  payload: input.workspaceId,
                },
              },
            },
            access_token: accessToken,
          },
          accessToken,
        ),
      ),
    });

    if (!res.ok) {
      const parsed = parseMetaError(await res.text().catch(() => ''));
      console.error('[marketing-optin] pedido rechazado:', res.status, parsed?.error?.message);
      return false;
    }

    // Deja rastro de que ya se preguntó, aunque la persona nunca conteste:
    // sin esto se le volvería a pedir en cada conversación.
    await db.from('ig_proactive_log').insert({
      workspace_id: input.workspaceId,
      kind: 'optin',
      text: input.externalContactId,
    });
    return true;
  } catch (err) {
    console.error('[marketing-optin] requestOptIn falló:', err);
    return false;
  }
}

/**
 * Escribirle a alguien que dio permiso, fuera de toda ventana.
 *
 * El cooldown de 48 h se comprueba acá y no en quien llama: es un tope de Meta
 * que devuelve error, no una preferencia del comercio, y cada llamador que se
 * lo olvide quema entregas.
 */
export async function sendToSubscriber(
  db: SupabaseClient,
  optin: MarketingOptin,
  input: { senderId: string; accessTokenEncrypted: string; text: string },
): Promise<{ ok: boolean; reason?: string }> {
  if (optin.status !== 'active') return { ok: false, reason: 'not_active' };
  if (optin.next_eligible_at && new Date(optin.next_eligible_at) > new Date()) {
    return { ok: false, reason: 'cooldown' };
  }
  if (
    optin.token_expiry_timestamp &&
    new Date(optin.token_expiry_timestamp) <= new Date()
  ) {
    await db
      .from('meta_marketing_optins')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', optin.id);
    return { ok: false, reason: 'expired' };
  }

  try {
    const accessToken = decrypt(input.accessTokenEncrypted);
    if (!accessToken) return { ok: false, reason: 'no_token' };
    await assertWorkspaceWritable(db,optin.workspace_id);
    await assertRecoveryStillUnanswered(db,'');

    const res = await fetch(`${GRAPH}/${input.senderId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        withAppsecretProofBody(
          {
            // La diferencia con un DM normal es exactamente esta línea: se
            // dirige al TOKEN, no a la persona. Por eso no lleva
            // `messaging_type`, que es lo que ata un envío a la ventana.
            recipient: { notification_messages_token: optin.notification_messages_token },
            message: { text: input.text },
            access_token: accessToken,
          },
          accessToken,
        ),
      ),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const parsed = parseMetaError(body);
      const described = describeMetaSendError(optin.channel, res.status, parsed);

      // Sólo se da de baja un permiso ante un rechazo DEFINITIVO.
      //
      // Antes cualquier respuesta no-2xx lo marcaba 'revoked', y nada vuelve a
      // poner un permiso en 'active': un 500 pasajero de Graph o un tope de
      // frecuencia borraban para siempre un consentimiento que la persona sí
      // había dado. Es el único activo que esta funcionalidad construye y no
      // se recupera sin volver a pedírselo a cada uno.
      const permanent =
        described.permanent &&
        described.category !== 'rate_limit' &&
        res.status < 500;
      if (permanent) {
        await db
          .from('meta_marketing_optins')
          .update({ status: 'revoked', updated_at: new Date().toISOString() })
          .eq('id', optin.id);
      }
      console.error(
        `[marketing-optin] envío rechazado (${res.status}, ${described.category}, ${
          permanent ? 'baja definitiva' : 'se reintenta'
        }):`,
        parsed?.error?.message ?? body.slice(0, 200),
      );
      return { ok: false, reason: parsed?.error?.message ?? `http_${res.status}` };
    }

    const now = new Date();
    await db
      .from('meta_marketing_optins')
      .update({
        last_sent_at: now.toISOString(),
        next_eligible_at: new Date(now.getTime() + MARKETING_COOLDOWN_MS).toISOString(),
        sent_count: optin.sent_count + 1,
        updated_at: now.toISOString(),
      })
      .eq('id', optin.id);
    return { ok: true };
  } catch (err) {
    console.error('[marketing-optin] sendToSubscriber falló:', err);
    return { ok: false, reason: 'exception' };
  }
}

/**
 * Pedir el permiso aprovechando que el agente acaba de contestar.
 *
 * Es el único momento en que se puede: la ventana está abierta justamente
 * porque la persona nos escribió recién. Envuelve `requestOptIn` con todas las
 * guardas del workspace para que quien llama —el runner, la respuesta a un
 * comentario— no tenga que acordarse de ninguna.
 *
 * Silencioso y fail-soft por diseño: corre después de un mensaje que ya salió
 * bien, así que nada de lo que pase acá puede afectar esa respuesta.
 */
export async function maybeRequestOptIn(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    channel: string;
    connection: {
      id?: string | null;
      config?: Record<string, unknown> | null;
      secrets?: Record<string, unknown> | null;
    } | null;
    externalContactId: string | null | undefined;
    /** Contacto de Riverz: si se dio de baja de lo proactivo, ni se le pregunta. */
    contactOptedOut?: boolean | null;
  },
): Promise<void> {
  try {
    if (input.channel !== 'instagram' && input.channel !== 'messenger') return;
    if (!input.externalContactId || !input.connection?.id) return;
    if (input.contactOptedOut) return;

    const { featureEnabled, proactiveGate } = await import(
      '@/lib/instagram-agent/controls'
    );
    if (!(await featureEnabled(db, input.workspaceId, 'marketing_optin'))) return;
    // Cuenta contra el mismo tope diario que los DMs proactivos: es un envío
    // más que sale de esta cuenta y pesa igual en su reputación.
    const gate = await proactiveGate(db, input.workspaceId);
    if (!gate.ok) return;

    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    // SIEMPRE `page_id`, también en Instagram.
    //
    // La API de mensajes de Instagram se llama sobre la PÁGINA de Facebook
    // vinculada, no sobre el id de la cuenta de IG — es lo que hace
    // `instagramAdapter.sendText`, que es el camino que funciona en
    // producción. Usar `ig_user_id` devuelve "(#3) Application does not have
    // the capability to make this API call", medido contra la cuenta real.
    const senderId = String(cfg.page_id ?? '');
    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const accessTokenEncrypted = String(secrets.access_token ?? '');
    if (!senderId || !accessTokenEncrypted) return;

    // `requestOptIn` deja el rastro en ig_proactive_log — es el mismo registro
    // que consulta para no volver a preguntarle a la misma persona.
    await requestOptIn(db, {
      workspaceId: input.workspaceId,
      connectionId: input.connection.id,
      channel: input.channel as OptinChannel,
      externalContactId: input.externalContactId,
      senderId,
      accessTokenEncrypted,
    });
  } catch (err) {
    console.error('[marketing-optin] maybeRequestOptIn falló:', err);
  }
}

/** Suscriptores del workspace a los que se les puede escribir AHORA. */
export async function reachableSubscribers(
  db: SupabaseClient,
  workspaceId: string,
  limit = 2000,
): Promise<MarketingOptin[]> {
  const nowIso = new Date().toISOString();
  const { data } = await db
    .from('meta_marketing_optins')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .or(`next_eligible_at.is.null,next_eligible_at.lte.${nowIso}`)
    .limit(limit);
  return (data ?? []) as MarketingOptin[];
}

/** Cuántos suscriptores tiene el workspace (para el contador de la pantalla). */
export async function countSubscribers(
  db: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { count } = await db
    .from('meta_marketing_optins')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  return count ?? 0;
}
