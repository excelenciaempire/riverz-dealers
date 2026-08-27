/**
 * Códigos de error de ENTREGA de WhatsApp Cloud API → claves i18n legibles
 * (los textos es/en viven en `lib/i18n/messages/deliveryErrors.ts`).
 *
 * Por qué existe: Meta no traduce sus errores y muchos ni siquiera llegan con
 * código (un `failed` sin `errors[]`, o un mensaje que queda en `sent` para
 * siempre por TTL-drop / pausa de marketing a EE.UU. / número no alcanzable).
 * La bandeja usa este mapa para mostrarle al comerciante, en su idioma, POR QUÉ
 * no se entregó y qué hacer — en vez del `[code] texto en inglés` crudo.
 *
 * Módulo PURO (sin React ni imports de servidor): lo usan el webhook (servidor)
 * y la burbuja del inbox (cliente).
 *
 * Referencias oficiales: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 * y https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits
 */

export interface MetaStatusErrorLike {
  code?: number
  title?: string
  message?: string
  error_data?: { details?: string }
}

interface CodeMeta {
  /** Sufijo de la clave i18n en el namespace `deliveryErrors`. */
  key: string
  /** Meta suele NO informar el motivo / no-entrega silenciosa (queda en `sent`
   *  o llega `failed` sin código). Informativo. */
  silent?: boolean
}

/** Mapa código → clave i18n. Un código sin entrada cae a `unknownWithCode`. */
const CODES: Record<number, CodeMeta> = {
  131026: { key: 'code131026' }, // no entregable: no es WhatsApp / no aceptó ToS / versión vieja
  131047: { key: 'code131047' }, // +24h desde la última respuesta → hay que usar plantilla
  131049: { key: 'code131049' }, // cap por-usuario de MARKETING ("healthy ecosystem")
  131050: { key: 'code131050' }, // el usuario optó por no recibir marketing
  130472: { key: 'code130472' }, // holdout de experimento de marketing de Meta
  131048: { key: 'code131048' }, // restricción por spam / calidad del número
  131056: { key: 'code131056' }, // demasiados mensajes al mismo par emisor-receptor
  132015: { key: 'code132015' }, // plantilla pausada/retenida por baja calidad
  132016: { key: 'code132016' }, // plantilla deshabilitada por baja calidad
  132000: { key: 'code132000' }, // número de parámetros de la plantilla no coincide
  130429: { key: 'code130429' }, // límite de throughput alcanzado (reintentar)
  131031: { key: 'code131031' }, // cuenta restringida por política
  131064: { key: 'code131064' }, // límite por violaciones de clasificación de plantillas
  131042: { key: 'code131042' }, // error de método de pago / línea de crédito
  141006: { key: 'code131042' }, // pago (aparece en health_status) → misma explicación
  131045: { key: 'code131045' }, // error de registro del número
  131052: { key: 'code131052' }, // Meta no pudo descargar el archivo de la URL
  131053: { key: 'code131053' }, // formato/tamaño no soportado (WebP, HEIC, >5 MB)
  130403: { key: 'code130403' }, // el negocio bloqueó a este usuario
  131000: { key: 'code131000' }, // error desconocido de Meta
  131016: { key: 'code131016' }, // servicio de WhatsApp temporalmente no disponible
  141010: { key: 'code141010' }, // negocio sin verificar (aparece en health_status)
  // Errores de PLANTILLA. No son de entrega: Meta rechaza el envío entero
  // antes de intentarlo, así que el cliente no recibe nada. Aparecen sobre todo
  // en corridas de automatizaciones y campañas, y hasta ahora llegaban a la
  // pantalla en inglés y con el número pelado ("(#131008) Required parameter
  // is missing"), que no le dice a nadie qué arreglar.
  131008: { key: 'code131008' }, // falta un parámetro obligatorio (variable vacía)
  131009: { key: 'code131009' }, // el valor de un parámetro no es válido
  132001: { key: 'code132001' }, // la plantilla no existe en ese idioma
  132005: { key: 'code132005' }, // el texto traducido excede el largo permitido
  132007: { key: 'code132007' }, // el contenido viola el formato permitido
  132012: { key: 'code132012' }, // el formato del parámetro no coincide
  131051: { key: 'code131051' }, // tipo de mensaje no soportado
  133010: { key: 'code133010' }, // el número no está registrado en la Cloud API
  100: { key: 'code100' }, // parámetro inválido (genérico de Graph)
  // Código PRIVADO de Riverz (fuera del rango de Meta): marketing a EE.UU.
  // bloqueado del lado del cliente (Meta no lo entrega y quedaría en 'sent'
  // para siempre). Ver isUsPhone / US_MARKETING_BLOCKED_CODE.
  4001: { key: 'usMarketingBlocked', silent: true },
}

/** Código privado (no-Meta) para el bloqueo de marketing a EE.UU. */
export const US_MARKETING_BLOCKED_CODE = 4001

/** Códigos de Meta que son transitorios aunque el HTTP no sea 5xx: reintentar
 *  es seguro porque Meta rechazó ANTES de actuar (no puede duplicar). */
export const TRANSIENT_META_CODES = new Set([130429, 131016, 131000])

/** Clave i18n completa (`deliveryErrors.codeN`) para un código, o null si no
 *  hay código. Un código no mapeado devuelve `deliveryErrors.unknownWithCode`. */
export function deliveryErrorKey(code?: number | null): string | null {
  if (code == null) return null
  const m = CODES[code]
  return `deliveryErrors.${m ? m.key : 'unknownWithCode'}`
}

/** Texto crudo del motivo que mandó Meta (sin prefijo `[code]`), o null. Se
 *  guarda como fallback para cuando el código no está mapeado. */
export function metaErrorText(errors?: MetaStatusErrorLike[]): string | null {
  const e = errors?.[0]
  if (!e) return null
  return e.error_data?.details || e.message || e.title || null
}

/** Código del primer error de un status `failed`, o null si Meta no lo informó. */
export function metaErrorCode(errors?: MetaStatusErrorLike[]): number | null {
  return errors?.[0]?.code ?? null
}
