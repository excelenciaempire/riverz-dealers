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
 *  - `account_review_status` del WABA. Mientras no sea APPROVED la Cloud API
 *    no envía, aunque el teléfono del comerciante siga funcionando (la app del
 *    celular no pasa por la API). Asignar un partner al WABA puede meter la
 *    cuenta en revisión, así que esto hay que releerlo DESPUÉS de conectar.
 *  - `health_status`, que desglosa por entidad (número / WABA / negocio / app)
 *    y trae el código de error y la solución sugerida por Meta.
 */

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

  // Una WABA que no está APPROVED no envía por Cloud API, por más que el
  // desglose de entidades venga limpio.
  const reviewBlocks = reviewStatus !== null && reviewStatus !== "APPROVED";
  if (reviewBlocks) {
    blockers.push({
      entity: "WABA",
      code: null,
      description: `account_review_status=${reviewStatus}`,
      solution: null,
    });
  }

  return {
    ...empty,
    reviewStatus,
    canSendMessage,
    canSend: !reviewBlocks && canSendMessage !== "BLOCKED",
    blockers,
    notices,
  };
}
