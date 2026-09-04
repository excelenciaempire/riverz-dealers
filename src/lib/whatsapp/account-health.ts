/**
 * Estado real de una cuenta de WhatsApp en Meta.
 *
 * Existe porque el onboarding guardaba `status: "connected"` sin comprobar
 * NADA: la conexión de un comercio real quedó marcada como conectada mientras
 * la Cloud API rechazaba cada envío con 131031, y el comerciante solo se
 * enteró cuando sus campañas no salieron. Meta sí expone el motivo — nadie lo
 * estaba leyendo.
 *
 * Dos señales, distintas y ambas necesarias:
 *
 *  - `account_review_status` del WABA. Solo REJECTED impide enviar y exige
 *    acción del comercio. PENDING es el estado NORMAL tras conectar por
 *    coexistencia — Meta revisa el negocio en segundo plano (hasta 24 h) y
 *    permite enviar mientras tanto (los mensajes iniciados por el cliente
 *    siempre; los iniciados por el negocio pueden esperar a que termine).
 *    Tratar PENDING como bloqueo dejaba el canal "conectado pero sin enviar"
 *    justo en la ventana en que la competencia (y Meta) ya deja mandar.
 *    Asignar un partner al WABA puede meter la cuenta en revisión, así que
 *    esto hay que releerlo DESPUÉS de conectar.
 *  - `health_status`, que desglosa por entidad (número / WABA / negocio / app)
 *    y trae el código de error y la solución sugerida por Meta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { withAppsecretProof } from "@/lib/channels/meta-graph";

const GRAPH = "https://graph.facebook.com/v22.0";

/** Entidad del desglose de `health_status`. */
export interface HealthEntity {
  entity_type?: string;
  id?: string;
  can_send_message?: "AVAILABLE" | "LIMITED" | "BLOCKED" | string;
  errors?: {
    error_code?: number;
    error_description?: string;
    possible_solution?: string;
  }[];
  additional_info?: string[];
}

export interface WhatsAppAccountHealth {
  /** APPROVED | PENDING | REJECTED | null si Meta no lo devuelve. */
  reviewStatus: string | null;
  /** Meta está revisando la cuenta (PENDING). NO bloquea el envío — es un
   *  aviso: se puede mandar mientras la revisión termina (hasta 24 h). */
  reviewPending: boolean;
  /** Veredicto agregado de Meta para el número. */
  canSendMessage: "AVAILABLE" | "LIMITED" | "BLOCKED" | null;
  /** ¿Puede enviar por Cloud API ahora mismo? */
  canSend: boolean;
  /** Motivos bloqueantes, ya legibles, para mostrar al comerciante. */
  blockers: {
    entity: string;
    code: number | null;
    description: string;
    solution: string | null;
  }[];
  /** Avisos no bloqueantes (p. ej. display name sin aprobar). */
  notices: string[];
}

/**
 * Consulta el estado de la cuenta. Nunca lanza: si Meta no responde
 * devolvemos `canSend: true` con `reviewStatus: null` para NO bloquear una
 * conexión por un fallo transitorio de red — el chequeo es una red de
 * seguridad, no un portero.
 */
export async function fetchWhatsAppAccountHealth(args: {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
}): Promise<WhatsAppAccountHealth> {
  const empty: WhatsAppAccountHealth = {
    reviewStatus: null,
    reviewPending: false,
    canSendMessage: null,
    canSend: true,
    blockers: [],
    notices: [],
  };

  const get = async (path: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(withAppsecretProof(`${GRAPH}/${path}`, args.accessToken), {
        headers: { Authorization: `Bearer ${args.accessToken}` },
      });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const [waba, phone] = await Promise.all([
    get(`${args.wabaId}?fields=account_review_status`),
    get(`${args.phoneNumberId}?fields=health_status`),
  ]);

  const reviewStatus = (waba?.account_review_status as string | undefined) ?? null;

  const health = phone?.health_status as
    | { can_send_message?: string; entities?: HealthEntity[] }
    | undefined;
  const canSendMessage = (health?.can_send_message as WhatsAppAccountHealth["canSendMessage"]) ?? null;

  const blockers: WhatsAppAccountHealth["blockers"] = [];
  const notices: string[] = [];

  for (const e of health?.entities ?? []) {
    for (const info of e.additional_info ?? []) notices.push(info);
    // Solo BLOCKED impide enviar. LIMITED es un tope de volumen (p. ej. un
    // negocio sin verificar envía igual, con cupo reducido) — tratarlo como
    // bloqueo fue justo el error de diagnóstico que motivó este archivo.
    if (e.can_send_message !== "BLOCKED") continue;
    for (const err of e.errors ?? []) {
      blockers.push({
        entity: e.entity_type ?? "UNKNOWN",
        code: err.error_code ?? null,
        description: err.error_description ?? "",
        solution: err.possible_solution ?? null,
      });
    }
  }

  // Solo REJECTED es bloqueante: la revisión de Meta rechazó la cuenta y el
  // comercio debe resolverlo. PENDING NO bloquea — Meta revisa en segundo
  // plano y deja enviar mientras tanto (así arranca la coexistencia en todas
  // las plataformas). Tratar PENDING como bloqueo era el bug que dejaba el
  // canal "conectado pero sin enviar".
  const reviewRejected = reviewStatus === "REJECTED";
  if (reviewRejected) {
    blockers.push({
      entity: "WABA",
      code: null,
      description: `account_review_status=${reviewStatus}`,
      solution: null,
    });
  }
  const reviewPending =
    reviewStatus !== null && reviewStatus !== "APPROVED" && !reviewRejected;

  // Los errores de MÉTODO DE PAGO (141006 / 131042) bloquean SOLO los mensajes
  // iniciados por el negocio (plantillas, campañas) — NO los de sesión, que el
  // número puede seguir respondiendo. Además ya se avisan con el link directo
  // "configurar método de pago" en la tarjeta del canal. Tratarlos como "no
  // puede enviar" era un falso negativo: dejaba el canal marcado en rojo aunque
  // recibiera y respondiera con normalidad, y el aviso quedaba pegado a un
  // snapshot viejo aunque el comercio ya hubiera cargado la tarjeta.
  const PAYMENT_CODES = new Set([141006, 131042]);
  const hardBlockers = blockers.filter((b) => !PAYMENT_CODES.has(b.code ?? -1));

  return {
    ...empty,
    reviewStatus,
    reviewPending,
    canSendMessage,
    // Solo un bloqueo REAL (review rechazado, número no registrado, cuenta
    // restringida) marca el canal como "no puede enviar". El pago se maneja
    // aparte con su propio link.
    canSend: hardBlockers.length === 0,
    blockers,
    notices,
  };
}

/**
 * Persiste el snapshot de salud sobre la conexión (migración 111) para que el
 * panel "Estado de WhatsApp" y el refresco periódico lo muestren sin volver a
 * pegarle a Meta en cada render. Best-effort: nunca lanza. `messaging_limit_tier`
 * se refresca aparte (refreshMessagingLimitTier).
 */
export async function persistWhatsAppHealthSnapshot(
  db: SupabaseClient,
  connectionId: string,
  health: WhatsAppAccountHealth,
  qualityRating?: string | null,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      health_can_send: health.canSendMessage,
      health_review_status: health.reviewStatus,
      health_blockers: health.blockers,
      health_checked_at: new Date().toISOString(),
    };
    if (qualityRating != null && qualityRating !== "") {
      patch.quality_rating = qualityRating;
    }
    await db.from("channel_connections").update(patch).eq("id", connectionId);
    const { data: connection } = await db
      .from("channel_connections")
      .select("workspace_id")
      .eq("id", connectionId)
      .maybeSingle();
    if (connection?.workspace_id) {
      const { reconcileWorkspaceAutomationReadiness } = await import('@/lib/automations/activation');
      await reconcileWorkspaceAutomationReadiness(db, connection.workspace_id);
    }
  } catch (err) {
    console.warn("[whatsapp] persist health snapshot failed:", err);
  }
}
