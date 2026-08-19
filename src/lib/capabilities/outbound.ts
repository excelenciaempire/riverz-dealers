/**
 * Lo que sale hacia afuera: plantillas de WhatsApp y campañas.
 *
 * Son las dos cosas que explican la mayoría de los "no salió nada": una
 * plantilla rechazada no se puede usar en ninguna campaña ni automatización, y
 * una campaña que quedó trabada en "enviando" parece haber salido y no salió.
 */
import { isStalledBroadcast, since, windowDays } from './predicates'
import type { Capability, CapabilityContext } from './types'

async function plantillas(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('message_templates')
    .select('name, category, language, status, rejected_reason, quality_score, updated_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('updated_at', { ascending: false })
    .limit(100)

  const filas = (data ?? []) as Array<{ status: string | null; name: string }>
  const estado = (s: string | null) => (s ?? '').toLowerCase()

  return {
    total: filas.length,
    // Se destacan porque son las accionables: una rechazada hay que corregirla
    // y una que lleva días en pendiente suele ser el WABA bloqueado por
    // facturación, no la plantilla.
    rechazadas: filas.filter((t) => estado(t.status) === 'rejected').length,
    pendientes: filas.filter((t) => estado(t.status) === 'pending').length,
    plantillas: filas,
  }
}

async function campanas(ctx: CapabilityContext, args: Record<string, unknown>) {
  const d = windowDays(args.dias, 30)
  const { data } = await ctx.db
    .from('broadcasts')
    .select(
      'id, name, template_name, status, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count, scheduled_at, error_message, created_at, updated_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .gte('created_at', since(d))
    .order('created_at', { ascending: false })
    .limit(50)

  const filas = (data ?? []) as Array<{ status: string; updated_at: string }>
  return {
    periodo_dias: d,
    trabadas: filas.filter(isStalledBroadcast).length,
    campanas: filas,
  }
}

export const OUTBOUND_CAPABILITIES: Capability[] = [
  {
    key: 'plantillas.estado',
    description:
      'Las plantillas de WhatsApp con su estado en Meta y el motivo de rechazo cuando lo hay. Una rechazada no se puede usar en ninguna campaña ni automatización, así que suele ser la causa de que algo no salga.',
    descriptionEn:
      'The WhatsApp templates with their status at Meta and the rejection reason when there is one. A rejected template cannot be used in any campaign or automation, so it is often the reason something does not go out.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: plantillas,
  },

  {
    key: 'campanas.estado',
    description:
      'Las campañas y cómo terminaron: a cuántos salió, cuántos la recibieron, cuántos contestaron y cuántas fallaron. Incluye las que quedaron trabadas en "enviando".',
    descriptionEn:
      'The campaigns and how they ended: how many were targeted, how many received it, how many replied and how many failed. Includes the ones stuck in "sending".',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 30, máximo 90.' },
      },
    },
    run: campanas,
  },
]
