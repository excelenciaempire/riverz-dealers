/**
 * Las reglas de negocio chiquitas que decidían cosas grandes, escritas una vez.
 *
 * "Pendiente", "trabada" y "este teléfono es este contacto" no son detalles de
 * implementación: son definiciones. Estaban repetidas —el match telefónico
 * estaba copiado literalmente en dos archivos del MCP— y una copia se puede
 * corregir sin la otra, que es como dos pantallas terminan discrepando sobre
 * la misma conversación.
 */

/** Ventana en días, acotada para que una pregunta no barra la base entera. */
export function windowDays(raw: unknown, def = 7, max = 90): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(Math.floor(n), max)
}

/** Instante ISO de hace `days` días, para un `.gte('created_at', …)`. */
export function since(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/**
 * Últimos 8 dígitos de un teléfono.
 *
 * Lo que guarda la base y lo que escribe una persona casi nunca coinciden en
 * el prefijo: el mismo número aparece como 54911…, +5411… o 11…. El final es
 * lo único estable. Ocho dígitos es el largo que distingue sin exigir país.
 */
export function phoneTail(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '').slice(-8)
}

/** ¿Hay suficientes dígitos como para buscar por teléfono y no por nombre? */
export function looksLikePhone(raw: string): boolean {
  return raw.replace(/\D/g, '').length >= 6
}

/**
 * El último que habló fue el cliente ⇒ la pelota está de este lado.
 *
 * Es la definición de "conversación pendiente" en todo Riverz. Si contestó el
 * negocio, la conversación no está esperando nada aunque siga abierta.
 */
export const PENDING_SENDER = 'customer'

/** Horas que lleva esperando una conversación, para ordenar a quién atender. */
export function hoursWaiting(lastMessageAt: string | null | undefined): number | null {
  if (!lastMessageAt) return null
  return Math.round((Date.now() - Date.parse(lastMessageAt)) / 3_600_000)
}

/**
 * Una campaña "enviando" desde hace más de dos horas ya no está enviando:
 * está trabada. El envío real de un broadcast se resuelve en minutos.
 */
export const STALLED_BROADCAST_MS = 2 * 3_600_000

export function isStalledBroadcast(b: {
  status?: string | null
  updated_at?: string | null
}): boolean {
  if (b.status !== 'sending' || !b.updated_at) return false
  return Date.parse(b.updated_at) < Date.now() - STALLED_BROADCAST_MS
}
