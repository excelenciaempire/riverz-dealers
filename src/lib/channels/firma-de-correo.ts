import type { ChannelConnection } from '@/types'

/**
 * La firma al pie del correo.
 *
 * El correo salía sin nada: ni el nombre de quien atiende, ni el del negocio,
 * ni un teléfono. En chat eso está bien —el nombre está arriba, en la
 * conversación— pero un correo llega solo a una bandeja llena, y sin firma se
 * lee como enviado por un sistema.
 *
 * Vive en la conexión y no en el workspace porque un comercio puede tener dos
 * buzones —ventas y posventa— y no firman igual.
 *
 * Se agrega SÓLO si hay algo escrito: una firma vacía no puede convertirse en
 * dos saltos de línea al final de cada correo.
 */
export function firmaDe(connection: ChannelConnection): string {
  const cfg = (connection.config ?? {}) as Record<string, unknown>
  return String(cfg.signature ?? '').trim()
}

/** El cuerpo con la firma al pie, separada como se separa una firma. */
export function conFirma(cuerpo: string, connection: ChannelConnection): string {
  const firma = firmaDe(connection)
  if (!firma) return cuerpo
  // El separador de firma de toda la vida: los clientes de correo lo entienden
  // y la pliegan sola en las respuestas, en vez de citarla una y otra vez.
  return `${cuerpo.trimEnd()}\n\n-- \n${firma}`
}
