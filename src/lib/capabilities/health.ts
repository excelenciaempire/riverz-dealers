/**
 * En qué estado está la operación de una cuenta.
 *
 * La lista de "qué está roto" no se calcula acá: la calcula
 * `collectWorkspaceIssues` (migración 152), que ya existía justamente para que
 * el panel del comercio y el de plataforma no pudieran contradecirse. Esta
 * capacidad es el tercer consumidor de esa misma función, no una cuarta
 * versión de las mismas seis consultas.
 */
import { collectWorkspaceIssues } from '@/lib/health/issues'
import { since } from './predicates'
import type { Capability, CapabilityContext } from './types'

async function estado(ctx: CapabilityContext) {
  const desde24h = since(1)

  const [canales, autos, corridas, aprobaciones, problemas] = await Promise.all([
    ctx.db
      .from('channel_connections')
      .select('channel, status, label')
      .eq('workspace_id', ctx.workspaceId)
      .neq('status', 'disconnected'),
    ctx.db
      .from('automations')
      .select('id, name, trigger_type, is_active, execution_count, last_executed_at')
      .eq('workspace_id', ctx.workspaceId)
      .is('deleted_at', null),
    ctx.db
      .from('automation_logs')
      .select('status')
      .eq('workspace_id', ctx.workspaceId)
      .gte('created_at', desde24h),
    ctx.db
      .from('approval_requests')
      .select('id, kind, title, created_at')
      .eq('workspace_id', ctx.workspaceId)
      .eq('status', 'pendiente'),
    collectWorkspaceIssues(ctx.db, ctx.workspaceId),
  ])

  const logs = (corridas.data ?? []) as { status: string }[]
  return {
    canales: canales.data ?? [],
    automatizaciones: autos.data ?? [],
    corridas_24h: {
      total: logs.length,
      exito: logs.filter((l) => l.status === 'success').length,
      parciales: logs.filter((l) => l.status === 'partial').length,
      fallidas: logs.filter((l) => l.status === 'failed').length,
    },
    esperando_aprobacion: aprobaciones.data ?? [],
    // Lo accionable, ya ordenado por gravedad. Es lo primero que hay que leer.
    problemas,
  }
}

export const HEALTH_CAPABILITIES: Capability[] = [
  {
    key: 'operacion.estado',
    description:
      'Panorama de la cuenta: canales conectados, automatizaciones con su última corrida, cómo salieron las corridas de las últimas 24 horas, decisiones esperando aprobación y la lista de lo que necesita atención (envíos fallando, plantillas rechazadas, automatizaciones trabadas, conexiones caídas).',
    descriptionEn:
      'Overview of the account: connected channels, automations with their last run, how the last 24 hours of runs went, decisions waiting for approval, and the list of what needs attention (failing sends, rejected templates, stuck automations, broken connections).',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: estado,
  },
]
