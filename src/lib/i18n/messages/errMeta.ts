import type { Namespace } from "./types";

/**
 * Merchant-facing messages for Meta Graph send/comment failures
 * (describeMetaSendError). These are surfaced in inbox toasts and campaign
 * logs, so they must follow the merchant's UI locale. `{label}` is the
 * channel name (Instagram / Messenger / Facebook comments / Instagram
 * comments), itself localized via the metaLabel* keys.
 */
export const errMeta = {
  // Channel labels interpolated as {label} into the messages below.
  metaLabelFbComments: { es: "los comentarios de Facebook", en: "Facebook comments" },
  metaLabelIgComments: { es: "los comentarios de Instagram", en: "Instagram comments" },

  metaAdvancedAccess: {
    es: '{label} todavía no puede escribirle a esta persona. Meta exige "acceso avanzado" a la mensajería, que se habilita aprobando tu app en la revisión de Meta (App Review). Mientras tanto solo puedes escribirle a cuentas que tengan un rol en tu app (admin/desarrollador/tester).',
    en: '{label} can’t message this person yet. Meta requires "advanced access" to messaging, which is granted once your app is approved in Meta App Review. Until then you can only message accounts that have a role in your app (admin/developer/tester).',
  },
  metaPermission: {
    es: "Esta acción en {label} necesita un permiso de Meta que aún no está habilitado para tu app. Hay que aprobarlo en la revisión de Meta (App Review), hasta entonces Meta no deja responder/gestionar este contenido.",
    en: "This action on {label} needs a Meta permission that isn’t enabled for your app yet. It has to be approved in Meta App Review; until then Meta won’t let you reply to or manage this content.",
  },
  metaOutsideWindow: {
    es: "Pasaron más de 24 horas desde el último mensaje del cliente, así que Meta no permite enviarle un mensaje libre por {label}. Espera a que el cliente vuelva a escribir, o usa una plantilla/etiqueta de mensaje aprobada por Meta.",
    en: "More than 24 hours have passed since the customer’s last message, so Meta won’t allow a free-form message on {label}. Wait for the customer to write again, or use a Meta-approved message template/tag.",
  },
  metaToken: {
    es: "La conexión de {label} perdió su acceso (token expirado o revocado). Vuelve a conectarla en Ajustes › Canales.",
    en: "The {label} connection lost its access (token expired or revoked). Reconnect it in Settings › Channels.",
  },
  metaRateLimit: {
    es: "Meta está limitando los envíos de {label} por ahora. Espera un momento e inténtalo de nuevo.",
    en: "Meta is rate-limiting {label} sends right now. Wait a moment and try again.",
  },
  metaRecipient: {
    es: "No se pudo entregar el mensaje por {label}: el destinatario no está disponible para recibir mensajes.",
    en: "Couldn’t deliver the message on {label}: the recipient isn’t available to receive messages.",
  },
  metaRejectedDetail: {
    es: "{label} rechazó el envío: {detail}",
    en: "{label} rejected the send: {detail}",
  },
  metaRejectedGeneric: {
    es: "{label} rechazó el envío (error {status}).",
    en: "{label} rejected the send (error {status}).",
  },
} satisfies Namespace;
