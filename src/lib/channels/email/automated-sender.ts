/**
 * ¿Este correo lo escribió una persona o una máquina?
 *
 * El 20 de agosto de 2026 entró un boletín de TikTok For Business desde un
 * `noreply@`. El agente lo tomó por un cliente y le contestó. El correo rebotó,
 * y el rebote de `postmaster@outlook.com` volvió a la bandeja como si fuera un
 * mensaje nuevo. El agente contestó el rebote. Postmaster contestó con su
 * automático ("This email address is not monitored"). El agente contestó otra
 * vez. Cuatro horas y 549 correos después, Microsoft bloqueó la casilla del
 * comercio por pasarse del límite diario de envíos. Ya había pasado igual el 4
 * de agosto: 490 correos. En total, 1.038 respuestas a un robot.
 *
 * Nada en el ingreso de correo distinguía humano de máquina: cualquier remitente
 * disparaba al agente. Este módulo es ese filtro. Lo que detecta se guarda y se
 * ve en la bandeja como cualquier otro correo (suma no leído) — sólo no se
 * contesta solo. Un rebote es información que el comercio TIENE que ver.
 *
 * El orden importa: primero las cabeceras, que son el estándar y no mienten
 * (RFC 3834 para autorespuestas, RFC 3464 para rebotes, RFC 2919/2369 para
 * listas). Recién después las heurísticas de dirección y asunto, para los
 * remitentes que no ponen ninguna cabecera.
 */

/** Motivo por el que se consideró automático. Sólo para registro/diagnóstico. */
export type AutomatedSenderReason =
  | "auto-submitted"
  | "auto-response-suppress"
  | "precedence-bulk"
  | "mailing-list"
  | "bounce-headers"
  | "delivery-report"
  | "null-return-path"
  | "sender-address"
  | "subject";

export interface AutomatedSenderVerdict {
  automated: boolean;
  reason?: AutomatedSenderReason;
}

/** Cabeceras del correo, tal como vienen: pares nombre/valor. */
export type EmailHeaders = { name: string; value: string }[];

export interface AutomatedSenderInput {
  /** Dirección del remitente, ya normalizada o no — da igual. */
  from?: string | null;
  subject?: string | null;
  headers?: EmailHeaders | null;
  /** `Content-Type` del mensaje cuando no viene entre las cabeceras. */
  contentType?: string | null;
}

/**
 * Parte local (antes de la arroba) que NUNCA es una persona, mire uno lo que
 * mire después. Se compara por PREFIJO porque los proveedores le cuelgan un
 * identificador: `no-reply-279i5hduqkb@mail.anthropic.com`, `noreply-tt4b@…`.
 */
const MACHINE_LOCAL_PREFIXES = [
  "noreply",
  "no-reply",
  "no_reply",
  "no.reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "postmaster",
  "mailer-daemon",
  "mailerdaemon",
  "mail-daemon",
  "autoreply",
  "auto-reply",
  "auto-response",
  "nepasrepondre",
  "ne-pas-repondre",
  "noresponder",
  "no-responder",
];

/**
 * Estas SÓLO valen como palabra entera (o con un `+etiqueta` / número pegado,
 * que es como firma un proveedor: `bounces+12345@sendgrid.net`).
 *
 * Van aparte a propósito. `bounce.hunter@gmail.com` y `notify.me.later@gmail.com`
 * son personas perfectamente posibles, y dejar a una clienta sin respuesta por
 * cómo se llama su casilla es peor que el problema que estamos arreglando.
 */
const MACHINE_LOCAL_EXACT = [
  "bounce",
  "bounces",
  "notification",
  "notifications",
  "notify",
  "automated",
  "daemon",
  "mailer",
];

/**
 * Asuntos de rebote y autorespuesta, anclados al principio (después de los
 * `RE:`/`FW:`). Es el ÚLTIMO recurso: un rebote de verdad siempre trae
 * cabeceras, así que acá se puede ser estricto sin perder nada.
 *
 * Y hay que serlo. Los avisos de no-entrega llevan SIEMPRE dos puntos y el
 * asunto original detrás ("No se puede entregar: RE: tu pedido"), mientras que
 * "no se puede entregar en mi barrio?" es una clienta preguntando por el envío.
 * Sin los dos puntos, ese correo se quedaba sin respuesta.
 */
const MACHINE_SUBJECT_PATTERNS = [
  // Rebotes — formato de aviso: "<etiqueta>: <asunto original>"
  /^undeliverable\s*:/,
  /^no se puede entregar\s*:/,
  /^correo no entregado\s*:/,
  /^devuelto al remitente\s*:/,
  /^non remis\s*:/,
  // Rebotes — etiquetas que no se confunden con nada
  /^undelivered mail returned to sender/,
  /^delivery status notification/,
  /^delivery has failed/,
  /^mail delivery (failed|subsystem)/,
  /^returned mail\b/,
  /^failure notice$/,
  // Autorespuestas / ausencias
  /^automatic reply\s*:/,
  /^auto(matic)?[- ]?response\s*:/,
  /^out of office\b/,
  /^respuesta automática\s*:/,
  /^fuera de la oficina\b/,
  /^ausencia de la oficina\b/,
  /^réponse automatique\s*:/,
  /^resposta automática\s*:/,
];

/** Quita los `RE:` / `FW:` / `RV:` encadenados del principio del asunto. */
function stripReplyPrefixes(subject: string): string {
  let s = subject.trim();
  // Tope de vueltas: un asunto con 200 "RE:" es basura, no una conversación.
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/^\s*(re|rv|fw|fwd|ref)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Saca la dirección de un `From` completo: `"Outlook Team" <a@b.com>` → `a@b.com`.
 * Si no hay ángulos, se usa el valor entero.
 */
function extractAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return (angled ? angled[1] : from).trim().toLowerCase();
}

/**
 * `true` si el correo lo generó una máquina y responderle no tiene sentido
 * (o, como pasó, es activamente dañino).
 */
export function detectAutomatedSender(
  input: AutomatedSenderInput,
): AutomatedSenderVerdict {
  const headers = input.headers ?? [];
  const get = (name: string): string | undefined => {
    const target = name.toLowerCase();
    return headers.find((h) => h.name?.toLowerCase() === target)?.value;
  };
  const has = (name: string): boolean => get(name) !== undefined;

  // ── 1. Cabeceras estándar ─────────────────────────────────────────────
  // RFC 3834: toda respuesta automática debe traerla. `no` es el único valor
  // que significa "lo escribió una persona".
  const autoSubmitted = get("Auto-Submitted");
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== "no") {
    return { automated: true, reason: "auto-submitted" };
  }

  // Microsoft/Exchange: la pone quien NO quiere recibir autorespuestas. Que
  // esté es señal de que del otro lado hay un sistema, no una persona.
  if (has("X-Auto-Response-Suppress")) {
    return { automated: true, reason: "auto-response-suppress" };
  }

  // Correo masivo (boletines, avisos). `Precedence: bulk|list|junk` es la
  // convención de siempre para "no contestes esto".
  const precedence = (get("Precedence") ?? get("X-Precedence") ?? "")
    .trim()
    .toLowerCase();
  if (["bulk", "list", "junk", "auto_reply"].includes(precedence)) {
    return { automated: true, reason: "precedence-bulk" };
  }

  // Listas de correo (RFC 2919 / 2369): boletines, notificaciones de producto.
  if (has("List-Unsubscribe") || has("List-Id") || has("List-Post")) {
    return { automated: true, reason: "mailing-list" };
  }

  // Rebotes.
  if (has("X-Failed-Recipients") || has("X-Autoreply") || has("X-Autorespond")) {
    return { automated: true, reason: "bounce-headers" };
  }

  // RFC 3464: el informe de entrega fallida viaja como multipart/report.
  const contentType = (get("Content-Type") ?? input.contentType ?? "").toLowerCase();
  if (
    contentType.includes("multipart/report") ||
    contentType.includes("delivery-status") ||
    contentType.includes("disposition-notification")
  ) {
    return { automated: true, reason: "delivery-report" };
  }

  // `Return-Path: <>` — el sobre vacío es, por definición, un mensaje que no
  // admite respuesta: así se evita que dos servidores reboten en círculo.
  if (has("Return-Path")) {
    const returnPath = (get("Return-Path") ?? "").trim();
    if (returnPath === "<>" || returnPath === "") {
      return { automated: true, reason: "null-return-path" };
    }
  }

  // ── 2. Dirección del remitente ────────────────────────────────────────
  const address = extractAddress(String(input.from ?? ""));
  const localPart = address.split("@")[0] ?? "";
  if (localPart) {
    const strong = MACHINE_LOCAL_PREFIXES.some(
      (p) =>
        localPart === p ||
        localPart.startsWith(`${p}-`) ||
        localPart.startsWith(`${p}.`) ||
        localPart.startsWith(`${p}_`) ||
        localPart.startsWith(`${p}+`),
    );
    // Palabra entera: se descarta un `+etiqueta` o unos dígitos al final y se
    // compara lo que queda. `bounces+12345` sí, `bounce.hunter` no.
    const bare = localPart.replace(/[+-][^@]*$/, "").replace(/\d+$/, "");
    const exact = MACHINE_LOCAL_EXACT.includes(bare);
    if (strong || exact) return { automated: true, reason: "sender-address" };
  }

  // ── 3. Asunto ─────────────────────────────────────────────────────────
  // Último recurso, para el remitente que no pone ninguna cabecera y usa una
  // dirección normal. Sólo patrones anclados al principio.
  const subject = stripReplyPrefixes(String(input.subject ?? "")).toLowerCase();
  if (subject && MACHINE_SUBJECT_PATTERNS.some((re) => re.test(subject))) {
    return { automated: true, reason: "subject" };
  }

  return { automated: false };
}

/** Azúcar para el sitio de llamada: sólo el booleano. */
export function isAutomatedSender(input: AutomatedSenderInput): boolean {
  return detectAutomatedSender(input).automated;
}
