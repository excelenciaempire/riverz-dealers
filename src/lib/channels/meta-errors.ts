/**
 * Translate a Meta Graph API send failure into a clear, actionable
 * Spanish message for the agent — instead of dumping the raw JSON error
 * into a toast. Used by the Instagram + Messenger adapters.
 *
 * Background: the most common send failures on Meta DM channels are NOT
 * code bugs, they're platform-policy / access-level limits. The two we
 * see in practice:
 *
 *  - code 200 / subcode 2534048 (Instagram) — the app lacks ADVANCED
 *    ACCESS to instagram_manage_messages, so it can only DM people who
 *    hold a role in the Meta app (admin/dev/tester). Fixed only by
 *    passing Meta App Review, never by retrying.
 *
 *  - code 10 / subcode 2018278 (Messenger) and IG equivalents — the send
 *    is OUTSIDE the 24-hour messaging window. Meta forbids free-form
 *    (`messaging_type: RESPONSE`) messages more than 24h after the
 *    customer's last message. Needs an approved message tag (e.g.
 *    HUMAN_AGENT, which itself requires the human_agent permission) or
 *    the customer to message first.
 *
 * `permanent` marks failures where retrying the same send is pointless
 * (so callers can skip retry/backoff and not waste quota).
 */

export type MetaSendErrorCategory =
  | "advanced_access" // app lacks Advanced Access — needs Meta App Review
  | "permission" // a required permission isn't granted/approved — needs App Review
  | "outside_window" // 24h messaging window elapsed
  | "token" // access token expired/revoked
  | "rate_limit" // throttled — transient
  | "recipient" // recipient not reachable / unknown id
  | "unknown";

export interface MetaErrorShape {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

export interface DescribedMetaError {
  category: MetaSendErrorCategory;
  /** Agent-facing Spanish message — safe to show in a toast / campaign log. */
  userMessage: string;
  /** True when retrying the identical send can't succeed. */
  permanent: boolean;
}

/** Parse a Meta error response body. Returns null if it wasn't JSON. */
export function parseMetaError(bodyText: string): MetaErrorShape | null {
  try {
    return JSON.parse(bodyText) as MetaErrorShape;
  } catch {
    return null;
  }
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  messenger: "Messenger",
  fb_comment: "los comentarios de Facebook",
  ig_comment: "los comentarios de Instagram",
};

/**
 * Map a (status, parsed body) pair to a categorized, human-readable error.
 * `channel` only tweaks wording ("Instagram"/"Messenger"); the logic is
 * shared.
 */
export function describeMetaSendError(
  channel: string,
  status: number,
  parsed: MetaErrorShape | null,
): DescribedMetaError {
  const err = parsed?.error;
  const code = err?.code;
  const subcode = err?.error_subcode;
  const label = CHANNEL_LABEL[channel] ?? "Meta";

  // Advanced Access missing — IG instagram_manage_messages / pages_messaging.
  // code 200 generally + subcode 2534048 specifically; also the message
  // text mentions "acceso avanzado" / "advanced access".
  const mentionsAdvanced = /acceso avanzado|advanced access/i.test(
    err?.message ?? "",
  );
  if (subcode === 2534048 || (code === 200 && mentionsAdvanced) || (code === 10 && mentionsAdvanced)) {
    return {
      category: "advanced_access",
      permanent: true,
      userMessage:
        `${label} todavía no puede escribirle a esta persona. Meta exige ` +
        `"acceso avanzado" a la mensajería, que se habilita aprobando tu app ` +
        `en la revisión de Meta (App Review). Mientras tanto solo puedes ` +
        `escribirle a cuentas que tengan un rol en tu app (admin/desarrollador/tester).`,
    };
  }

  // A required permission isn't available — deprecated or pending App
  // Review (e.g. `pages_read_user_content` / `pages_manage_engagement`
  // when replying to comments). Meta phrases it "The permission(s) X are
  // not available. It could because either they are deprecated or need to
  // be approved by App Review." code 200, no advanced-access subcode.
  if (
    code === 200 &&
    /permission/i.test(err?.message ?? "") &&
    /(app review|not available|deprecated|approved)/i.test(err?.message ?? "")
  ) {
    return {
      category: "permission",
      permanent: true,
      userMessage:
        `Esta acción en ${label} necesita un permiso de Meta que aún no está ` +
        `habilitado para tu app. Hay que aprobarlo en la revisión de Meta ` +
        `(App Review) — hasta entonces Meta no deja responder/gestionar este contenido.`,
    };
  }

  // 24-hour messaging window elapsed.
  // Messenger: code 10 / subcode 2018278. IG: code 10 / subcode 2534022.
  if (
    subcode === 2018278 ||
    subcode === 2534022 ||
    (code === 10 && /period|ventana|window|24/i.test(err?.message ?? ""))
  ) {
    return {
      category: "outside_window",
      permanent: true,
      userMessage:
        `Pasaron más de 24 horas desde el último mensaje del cliente, así que ` +
        `Meta no permite enviarle un mensaje libre por ${label}. Espera a que el ` +
        `cliente vuelva a escribir, o usa una plantilla/etiqueta de mensaje aprobada por Meta.`,
    };
  }

  // Token death — surfaced consistently with the connection auto-flip.
  if (
    code === 190 ||
    code === 102 ||
    code === 463 ||
    code === 467 ||
    (status === 401 && err?.type === "OAuthException")
  ) {
    return {
      category: "token",
      permanent: true,
      userMessage:
        `La conexión de ${label} perdió su acceso (token expirado o revocado). ` +
        `Vuelve a conectarla en Ajustes › Canales.`,
    };
  }

  // Throttling — transient, worth a retry later.
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return {
      category: "rate_limit",
      permanent: false,
      userMessage:
        `Meta está limitando los envíos de ${label} por ahora. Espera un momento ` +
        `e inténtalo de nuevo.`,
    };
  }

  // Unknown / unreachable recipient.
  if (code === 100 && (subcode === 2018001 || /recipient|destinatario/i.test(err?.message ?? ""))) {
    return {
      category: "recipient",
      permanent: true,
      userMessage:
        `No se pudo entregar el mensaje por ${label}: el destinatario no está ` +
        `disponible para recibir mensajes.`,
    };
  }

  // Fallback — keep Meta's own message if we have it, else a generic line.
  const detail = err?.message?.trim();
  return {
    category: "unknown",
    permanent: false,
    userMessage: detail
      ? `${label} rechazó el envío: ${detail}`
      : `${label} rechazó el envío (error ${status}).`,
  };
}
