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
import { translate } from '@/lib/i18n/translate'
import type { Artefacto } from '@/lib/operator/artifacts'
import { since } from './predicates'
import { lista, loc, tablero, tieneCampos, tt } from './vistas'
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


/**
 * Cómo está la operación, en un tablero.
 *
 * El resultado que lee el modelo son cinco listas y ciento y pico de filas: eso
 * en un párrafo no se lee, y en el panel tampoco si se vuelca crudo. Lo que
 * hace falta ver es una línea por cosa con su punto de color, en el orden en
 * que hay que atenderlas: primero lo roto, después lo que está apagado.
 *
 * Los avisos se traducen con el MISMO catálogo que usa la pantalla de Inicio
 * (`health.*`, con su `{n}`): dos textos para el mismo aviso es exactamente lo
 * que esta capa existe para evitar.
 */
function vistaEstado(
  ctx: CapabilityContext,
  r: Awaited<ReturnType<typeof estado>>,
): Artefacto | null {
  if (!tieneCampos(r, 'corridas_24h')) return null
  const filas: { que: string; estado: 'ok' | 'atencion' | 'roto' | 'apagado'; detalle?: string }[] =
    []

  // Lo accionable primero, ya ordenado por gravedad desde `collectWorkspaceIssues`.
  for (const p of lista<{ kind: string; count: number; severity: string; detail: string | null }>(
    r,
    'problemas',
  )) {
    filas.push({
      que: translate(loc(ctx), `health.${p.kind}`, { n: p.count }),
      estado: p.severity === 'critical' ? 'roto' : 'atencion',
      detalle: p.detail ?? undefined,
    })
  }

  for (const c of lista<{ channel: string; status: string; label: string | null }>(r, 'canales')) {
    filas.push({
      que: c.label || c.channel,
      estado: c.status === 'connected' ? 'ok' : 'atencion',
      detalle: c.channel,
    })
  }

  const autos = lista<{ name: string; is_active: boolean }>(r, 'automatizaciones')
  const prendidas = autos.filter((a) => a.is_active).length
  if (autos.length > 0) {
    filas.push({
      que: tt(ctx, 'operation.subAutomatizaciones'),
      // Todas apagadas no es un error, pero tampoco es "ok": no está pasando
      // nada solo, que es justo lo que alguien cree que está pasando.
      estado: prendidas === 0 ? 'apagado' : 'ok',
      detalle: `${prendidas}/${autos.length}`,
    })
  }

  const c24 = r.corridas_24h
  if (c24.total > 0) {
    filas.push({
      que: tt(ctx, 'operation.vCorridas24h'),
      estado: c24.fallidas > 0 ? 'atencion' : 'ok',
      detalle: `${c24.exito} ✓ · ${c24.fallidas} ✕`,
    })
  }

  const pendientes = lista(r.esperando_aprobacion).length
  if (pendientes > 0) {
    filas.push({
      que: tt(ctx, 'operation.vEsperandoAprobacion'),
      estado: 'atencion',
      detalle: String(pendientes),
    })
  }

  return tablero({ titulo: tt(ctx, 'operation.vTitSalud'), filas })
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
    vista: (ctx, _args, r) => vistaEstado(ctx, r as Awaited<ReturnType<typeof estado>>),
  },
]
