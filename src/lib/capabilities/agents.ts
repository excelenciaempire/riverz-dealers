/**
 * Los agentes de IA de la cuenta.
 *
 * Sólo lectura por ahora. Crear y activar agentes llega con la flota, que trae
 * el modelo de permisos por acción y el arbitraje entre roles; hacerlo antes
 * sería crear agentes que después no se pueden gobernar.
 */
import type { Capability, CapabilityContext } from './types'

async function listar(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('ai_agents')
    .select(
      'id, name, is_active, scope, product_scope, priority, language, tone, puede_crear_pedidos, voice_enabled, followup_enabled, created_at, ai_agent_channels(channel)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  const filas = (data ?? []) as unknown as Array<{
    id: string
    name: string
    is_active: boolean
    scope: string
    puede_crear_pedidos: boolean | null
    ai_agent_channels: { channel: string }[] | null
  }>

  return filas.map((a) => ({
    ...a,
    // El alcance real: `workspace` ocupa todos los canales aunque la tabla de
    // canales esté vacía. Sin esto, un agente de cuenta parece no atender nada.
    canales: a.scope === 'workspace' ? 'todos' : (a.ai_agent_channels ?? []).map((c) => c.channel),
    ai_agent_channels: undefined,
  }))
}

export const AGENT_CAPABILITIES: Capability[] = [
  {
    key: 'agentes.listar',
    description:
      'Los agentes de IA de la cuenta: si están activos, qué canales atienden, si pueden cerrar pedidos, si tienen voz y seguimiento.',
    descriptionEn:
      'The AI agents of the account: whether they are active, which channels they cover, whether they can close orders, and whether they have voice and follow-ups.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: listar,
  },
]
