import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n/config'
import {
  normalizarPliego,
  pliegoATexto,
  type ContextoPliego,
} from './pliego'

/**
 * Qué tiene conectado la cuenta, en los términos que le importan al pliego.
 *
 * Sirve para una sola cosa: no hacerle preguntas al comercio sobre lo que no
 * tiene. Preguntarle por Mercado Libre a quien no lo conectó es hacerle perder
 * el tiempo, y peor: deja una pregunta sin contestar para siempre, así que el
 * pliego nunca se termina y la pantalla siempre le debe algo.
 *
 * Lee las conexiones **activas**. Una conexión caída no es una capacidad: si
 * el token de Mercado Libre se venció, el bloque de Mercado Libre no tiene
 * nada que configurar todavía.
 */
export async function contextoDeLaCuenta(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ContextoPliego> {
  const [canales, tiendas] = await Promise.all([
    db
      .from('channel_connections')
      .select('channel, status')
      .eq('workspace_id', workspaceId),
    db
      .from('shopify_connections')
      .select('platform, status')
      .eq('workspace_id', workspaceId),
  ])

  const vivos = new Set(
    ((canales.data ?? []) as { channel: string; status: string | null }[])
      .filter((c) => c.status !== 'disconnected')
      .map((c) => c.channel),
  )
  const tiendasVivas = ((tiendas.data ?? []) as {
    platform: string
    status: string | null
  }[]).filter((t) => t.status !== 'disconnected')

  const meta =
    vivos.has('instagram') ||
    vivos.has('messenger') ||
    vivos.has('ig_comment') ||
    vivos.has('fb_comment')

  return {
    // Mercado Libre cuenta como tienda: hay catálogo, pedidos y postventa,
    // aunque no sea una tienda propia.
    tienda: tiendasVivas.length > 0 || vivos.has('mercadolibre'),
    whatsapp: vivos.has('whatsapp'),
    meta,
    mercadolibre: vivos.has('mercadolibre'),
    email: vivos.has('gmail') || vivos.has('outlook'),
    telefono: vivos.has('voice'),
  }
}

/**
 * El pliego de la cuenta, listo para el prompt del Operador.
 *
 * El Operador entra sabiendo QUÉ hay en la cuenta (el mapa) pero no QUÉ quiere
 * el comercio. Sin esto, «montá la operación» es una instrucción a ciegas: el
 * modelo elige por su cuenta si la IA puede reembolsar o hasta cuánto descuento
 * dar, que son justo las decisiones que no le corresponden.
 *
 * Devuelve cadena vacía si no hay nada contestado todavía: un encabezado sin
 * contenido gasta tokens en cada turno de cada comercio y no dice nada.
 */
export async function pliegoDeLaCuenta(
  db: SupabaseClient,
  workspaceId: string,
  locale: Locale,
): Promise<string> {
  const [{ data }, cuenta] = await Promise.all([
    db
      .from('operacion_setup')
      .select('pliego')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    contextoDeLaCuenta(db, workspaceId),
  ])
  const guardado = normalizarPliego((data as { pliego?: unknown } | null)?.pliego)
  if (Object.keys(guardado).length === 0) return ''
  return [
    'LAS REGLAS DE ESTE COMERCIO',
    'Las contestó él. Mandan sobre cualquier valor que elijas por tu cuenta.',
    'Entre corchetes va qué configura cada una.',
    '',
    pliegoATexto(cuenta, guardado, locale),
  ].join('\n')
}
