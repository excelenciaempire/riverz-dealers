import { NextResponse } from 'next/server';
import type { ChannelConnection, WebchatConfig } from '@/types';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { limitByKey, clientIp, rateLimitResponse } from '@/lib/rate-limit';
import { motorApagado } from '@/lib/workspaces/motor';
import { getFeatureFlags, isFeatureEnabled } from '@/lib/admin/feature-flags';
import { originAllowed } from './config';
import { getWebchatConnection, webchatConfig } from './connection-store';
import { sessionFromRequest, type WebchatSession } from './token';

/**
 * Lo que toda ruta del widget comprueba antes de hacer nada.
 *
 * Son endpoints sin sesión, abiertos a Internet y llamados desde el navegador
 * de cualquier visitante de la tienda, así que las comprobaciones van todas
 * juntas en un lugar: si una ruta nueva se olvida de una, el agujero queda en
 * producción y nadie se entera hasta que alguien lo usa.
 *
 * Los tres cortes que importan, en orden de costo:
 *   1. cupo por IP y por comercio (antes de tocar la base),
 *   2. el widget está encendido y la cuenta al día,
 *   3. la funcionalidad no está apagada por plataforma.
 */

/** Cupos. El chat web es más ruidoso que el resto: un visitante escribe rápido
 *  y el sondeo es constante, así que el límite de lectura es alto a propósito
 *  y el de escritura, no. */
export const WEBCHAT_LIMITS = {
  /** Abrir sesión: una por carga de página; de a ráfagas sólo si algo falla. */
  session: { limit: 30, windowMs: 60_000 },
  /** Escribir. Nadie escribe 30 mensajes en un minuto de verdad. */
  send: { limit: 30, windowMs: 60_000 },
  /** Sondear mensajes nuevos: uno cada 2,5 s por pestaña, más margen. */
  poll: { limit: 120, windowMs: 60_000 },
  identify: { limit: 10, windowMs: 60_000 },
  /** Pasarse a WhatsApp. Cada uno emite un código: se toca una vez, no diez. */
  whatsapp: { limit: 5, windowMs: 60_000 },
} as const;

export interface WebchatContext {
  workspaceId: string;
  connection: ChannelConnection;
  config: WebchatConfig;
}

type Guard = { ok: true; ctx: WebchatContext } | { ok: false; response: NextResponse };

/** El cupo de esta IP para esta acción, sin tocar la base. */
export async function checkIpLimit(
  req: Request,
  action: keyof typeof WEBCHAT_LIMITS,
): Promise<NextResponse | null> {
  const result = await limitByKey(`webchat:${action}:ip:${clientIp(req)}`, WEBCHAT_LIMITS[action]);
  return result.success ? null : rateLimitResponse(result);
}

/**
 * Carga la conexión del comercio y comprueba que el chat pueda atender.
 *
 * Todo lo que impide atender responde 404, no 403: quien prueba llaves a mano
 * no debe poder distinguir "no existe" de "existe pero está apagado" ni de
 * "existe y la cuenta está suspendida". La única excepción es el cupo, que sí
 * dice 429 porque el widget legítimo necesita saber cuándo reintentar.
 */
export async function loadWebchat(
  req: Request,
  workspaceId: string,
  action?: keyof typeof WEBCHAT_LIMITS,
): Promise<Guard> {
  const notFound = {
    ok: false as const,
    response: NextResponse.json({ error: 'not_found' }, { status: 404 }),
  };

  // Techo por comercio. Cubre lo que los otros dos cupos no ven: mucha gente
  // distinta —o muchos visitantes fabricados— pegándole al mismo chat a la vez.
  //
  // Va separado por tipo de acción porque el sondeo no cuesta lo mismo que
  // escribir, y mezclarlos convertía el techo en un apagón: cada pestaña
  // abierta sondea 24 veces por minuto, así que diez personas con el chat
  // abierto —sin escribir una palabra— agotaban el cupo entero y a partir de
  // ahí el widget respondía 429 a todo el mundo. Quien estaba conversando veía
  // que el agente no volvía nunca, y quien llegaba después no podía ni abrirlo.
  //
  // Lo que hay que frenar es lo que se paga: cada mensaje dispara una respuesta
  // del agente. Leer es barato y su techo sólo está para una avalancha real.
  const techo = action === 'poll' ? 3_000 : 240;
  const perWorkspace = await limitByKey(`webchat:ws:${action === 'poll' ? 'r' : 'w'}:${workspaceId}`, {
    limit: techo,
    windowMs: 60_000,
  });
  if (!perWorkspace.success) {
    return { ok: false, response: rateLimitResponse(perWorkspace) };
  }

  const connection = await getWebchatConnection(workspaceId);
  if (!connection) return notFound;
  const config = webchatConfig(connection);
  if (!config.enabled) return notFound;

  const admin = supabaseAdmin();
  if (await motorApagado(admin, workspaceId)) return notFound;

  const flags = await getFeatureFlags(admin, workspaceId);
  if (!isFeatureEnabled(flags, 'webchat')) return notFound;

  return { ok: true, ctx: { workspaceId, connection, config } };
}

/**
 * Las rutas que ya tienen sesión: valida el token y carga el comercio de una.
 * El visitante nunca dice a qué workspace ni a qué conversación pertenece —
 * sale todo del token firmado, así que no hay nada que pueda pedir prestado.
 */
export async function requireSession(
  req: Request,
  action: keyof typeof WEBCHAT_LIMITS,
  opciones?: { tokenEnQuery?: boolean },
): Promise<
  { ok: true; session: WebchatSession; ctx: WebchatContext } | { ok: false; response: NextResponse }
> {
  const limited = await checkIpLimit(req, action);
  if (limited) return { ok: false, response: limited };

  const session = sessionFromRequest(req, { permitirQuery: opciones?.tokenEnQuery });
  if (!session) {
    // 401 y no 404: el widget distingue "hay que renovar la sesión" de "este
    // chat ya no existe", y con lo segundo se apagaría solo para siempre.
    return {
      ok: false,
      response: NextResponse.json({ error: 'session_expired' }, { status: 401 }),
    };
  }

  // Cupo por VISITANTE, además del de IP.
  //
  // La IP no alcanza: detrás de un proxy compartido —o de una red móvil— mucha
  // gente distinta la comparte, y al revés, una sola persona puede rotarla. El
  // id del visitante sale del token firmado, así que es una clave estable que
  // el que llama no elige, y es la que mide lo que de verdad cuesta: cada
  // mensaje dispara una respuesta del agente, y eso se paga.
  const porVisitante = await limitByKey(
    `webchat:${action}:v:${session.visitorId}`,
    WEBCHAT_LIMITS[action],
  );
  if (!porVisitante.success) {
    return { ok: false, response: rateLimitResponse(porVisitante) };
  }

  const guard = await loadWebchat(req, session.workspaceId, action);
  if (!guard.ok) return guard;

  // El origen se validó al abrir la sesión, pero el token vive 24 h: sacar un
  // dominio de la lista —justamente lo que hace un comercio cuando descubre que
  // alguien le está usando el chat desde otro sitio— no cortaba nada hasta el
  // día siguiente. 401 y no 404 para que el widget legítimo pida una sesión
  // nueva en vez de apagarse solo.
  //
  // La prueba desde el panel no pasa por acá: su origen es el nuestro, que
  // nunca está en la lista de dominios de la tienda. Se emite sólo con sesión
  // del panel y para el propio workspace, así que no abre nada que su dueño no
  // tuviera ya.
  if (!session.pr && !originAllowed(session.origin, guard.ctx.config.allowed_domains)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'session_expired' }, { status: 401 }),
    };
  }

  return { ok: true, session, ctx: guard.ctx };
}
