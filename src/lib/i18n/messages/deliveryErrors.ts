import type { Namespace } from "./types";

/**
 * Motivos de no-entrega de WhatsApp, legibles y accionables, en el idioma del
 * comerciante. Se muestran en la burbuja de la bandeja cuando un mensaje
 * saliente falla, queda sin confirmar o entra en revisión de calidad. El código
 * de Meta se mapea a estas claves en `lib/whatsapp/delivery-errors.ts`.
 */
export const deliveryErrors = {
  code131026: {
    es: "No se pudo entregar: el número no tiene WhatsApp o no aceptó los términos.",
    en: "Couldn't be delivered: the number isn't on WhatsApp or hasn't accepted the terms.",
  },
  code131047: {
    es: "Pasaron más de 24 h desde la última respuesta del cliente. Se requiere una plantilla.",
    en: "More than 24 h since the customer last replied. A template is required.",
  },
  code131049: {
    es: "WhatsApp limitó los mensajes de marketing que recibe esta persona. Reintenta en 24 h.",
    en: "WhatsApp capped how many marketing messages this person receives. Retry in 24 h.",
  },
  code131050: {
    es: "El cliente se dio de baja de tus mensajes de marketing.",
    en: "The customer opted out of your marketing messages.",
  },
  code130472: {
    es: "WhatsApp no entregó este mensaje de marketing (usuario dentro de un experimento de Meta).",
    en: "WhatsApp didn't deliver this marketing message (user is in a Meta experiment).",
  },
  code131048: {
    es: "WhatsApp restringió los envíos de este número por calidad o reportes de spam.",
    en: "WhatsApp restricted sends from this number due to quality or spam reports.",
  },
  code131056: {
    es: "Demasiados mensajes a este mismo número en poco tiempo. Espera y reintenta.",
    en: "Too many messages to this same number in a short time. Wait and retry.",
  },
  code132015: {
    es: "La plantilla está pausada por baja calidad y no se puede enviar.",
    en: "The template is paused for low quality and can't be sent.",
  },
  code132016: {
    es: "La plantilla fue deshabilitada por baja calidad.",
    en: "The template was disabled for low quality.",
  },
  code132000: {
    es: "La plantilla se envió con una cantidad de variables incorrecta.",
    en: "The template was sent with the wrong number of variables.",
  },
  code130429: {
    es: "Se alcanzó el límite de velocidad de envío. Se reintenta solo.",
    en: "Sending rate limit reached. It retries automatically.",
  },
  code131031: {
    es: "La cuenta de WhatsApp está restringida por una violación de política.",
    en: "The WhatsApp account is restricted due to a policy violation.",
  },
  code131064: {
    es: "Se alcanzó el límite de mensajería por clasificación incorrecta de plantillas.",
    en: "Messaging limit reached due to template classification violations.",
  },
  code131042: {
    es: "Falta completar la información de pago o fiscal de tu cuenta de WhatsApp. Complétala en WhatsApp Manager para poder enviar.",
    en: "Your WhatsApp account's payment or tax information is incomplete. Complete it in WhatsApp Manager to send.",
  },
  code131045: {
    es: "El número no está registrado correctamente para enviar.",
    en: "The number isn't correctly registered to send.",
  },
  code130403: {
    es: "Este negocio bloqueó a este usuario en WhatsApp.",
    en: "This business has blocked this user on WhatsApp.",
  },
  code131000: {
    es: "Error desconocido de WhatsApp. Se reintenta solo.",
    en: "Unknown WhatsApp error. It retries automatically.",
  },
  code131016: {
    es: "El servicio de WhatsApp está temporalmente no disponible.",
    en: "WhatsApp service is temporarily unavailable.",
  },
  code141010: {
    es: "El negocio no está verificado. No bloquea el envío, pero limita el cupo.",
    en: "The business isn't verified. It doesn't block sending, but it caps your volume.",
  },
  usMarketingBlocked: {
    es: "WhatsApp no entrega marketing a números de EE.UU. Usa una plantilla de utilidad o espera a que el cliente escriba primero.",
    en: "WhatsApp doesn't deliver marketing to US numbers. Use a utility template or wait for the customer to message first.",
  },
  unknownWithCode: {
    es: "WhatsApp rechazó el mensaje (código {code}).",
    en: "WhatsApp rejected the message (code {code}).",
  },
  noReason: {
    es: "WhatsApp no entregó el mensaje y no informó el motivo (posible filtrado o número no alcanzable).",
    en: "WhatsApp didn't deliver the message and gave no reason (possible filtering or an unreachable number).",
  },
  unconfirmed: {
    es: "Enviado, pero WhatsApp no confirmó la entrega. Puede que el número no tenga WhatsApp o su teléfono esté apagado.",
    en: "Sent, but WhatsApp hasn't confirmed delivery. The number may not be on WhatsApp or the phone may be off.",
  },
  held: {
    es: "En revisión de calidad de WhatsApp (plantilla nueva). Se entrega o se descarta en breve.",
    en: "In WhatsApp quality review (new template). It'll be delivered or dropped shortly.",
  },
} satisfies Namespace;
