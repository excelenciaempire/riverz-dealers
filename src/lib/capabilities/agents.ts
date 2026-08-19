/**
 * Los agentes de IA de la cuenta.
 *
 * Crear y activar llegaron junto con la flota (migración 164), y no antes: sin
 * el rol y los permisos por acción, un agente creado desde acá no se podía
 * gobernar — nacía pudiendo todo lo que permitiera la infraestructura.
 *
 * Todo lo que se crea nace PAUSADO. Activar es una acción aparte porque es el
 * momento en que empieza a hablarle a clientes reales, y ahí se valida que no
 * le dispute el canal a otro agente del mismo rol.
 */
import { findChannelConflict, channelLabels } from '@/lib/ai/channel-conflict'
import { roleTemplate } from '@/lib/ai/role-templates'
import { isAgentRole, type AgentRole } from '@/lib/ai/roles'
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

async function crearBorrador(ctx: CapabilityContext, args: Record<string, unknown>) {
  const role: AgentRole = isAgentRole(args.rol) ? args.rol : 'general'
  const preset = roleTemplate(role)
  const canales = Array.isArray(args.canales) ? (args.canales as string[]) : []

  const { data, error } = await ctx.db
    .from('ai_agents')
    .insert({
      workspace_id: ctx.workspaceId,
      name: String(args.nombre ?? '').trim() || 'Asistente',
      // Nace pausado SIEMPRE. Un agente que empieza a contestar en el mismo
      // momento en que se crea no le da a nadie la oportunidad de leerlo.
      is_active: false,
      role,
      permissions: preset?.permissions ?? null,
      persona: String(args.persona ?? ''),
      knowledge: args.conocimiento ? String(args.conocimiento) : null,
      language: ctx.locale ?? 'es',
      escalate_keywords: preset?.escalateKeywords ?? [],
      followup_enabled: preset?.followupEnabled ?? false,
      puede_crear_pedidos: preset?.permissions.crear_pedidos === true,
      scope: canales.length > 0 ? 'channels' : 'workspace',
      product_scope: 'all',
    })
    .select('id, name, role, is_active')
    .single()
  if (error) throw new Error(error.message)
  const agent = data as { id: string; name: string; role: string; is_active: boolean }

  if (canales.length > 0) {
    await ctx.db
      .from('ai_agent_channels')
      .insert(canales.map((channel) => ({ agent_id: agent.id, channel })))
  }

  return { ...agent, nota: 'Queda pausado. Revisalo y activalo cuando estés listo.' }
}

async function activarAgente(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.agent_id)
  const activo = args.activo !== false

  const { data: cur } = await ctx.db
    .from('ai_agents')
    .select('id, name, scope, role, voice_enabled, ai_agent_channels(channel)')
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  const fila = cur as
    | {
        id: string
        name: string
        scope: string
        role?: string | null
        voice_enabled?: boolean | null
        ai_agent_channels?: { channel: string }[]
      }
    | null
  if (!fila) throw new Error('ese agente no existe en esta cuenta')

  if (activo) {
    const conflicto = await findChannelConflict(ctx.db, {
      workspaceId: ctx.workspaceId,
      agentId: id,
      scope: fila.scope,
      channels: (fila.ai_agent_channels ?? []).map((c) => c.channel),
      voiceEnabled: fila.voice_enabled !== false,
      role: fila.role,
    })
    if (conflicto) {
      throw new Error(
        `«${conflicto.agentName}» ya atiende ${channelLabels(conflicto.channels, ctx.locale)} con el mismo rol. Pausalo o cambiá el rol de este.`,
      )
    }
  }

  const { data, error } = await ctx.db
    .from('ai_agents')
    .update({ is_active: activo })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .select('id, name, is_active, role')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
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

  {
    key: 'agentes.crear_borrador',
    description:
      'Crea un agente con el preset de su rol (qué puede hacer, qué escala a una persona, si hace seguimiento). Nace pausado: no le contesta a nadie hasta que se active.',
    descriptionEn:
      'Creates an agent with its role preset (what it can do, what it escalates to a human, whether it follows up). It starts paused: it answers nobody until activated.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        rol: {
          type: 'string',
          enum: ['general', 'ventas', 'postventa', 'recuperacion', 'retencion'],
        },
        persona: { type: 'string', description: 'Cómo habla y qué sabe del negocio.' },
        conocimiento: { type: 'string' },
        canales: {
          type: 'array',
          items: { type: 'string' },
          description: 'Vacío = atiende todos los canales de la cuenta.',
        },
      },
      required: ['nombre', 'rol'],
    },
    // Nace pausado: no le contesta a nadie hasta que se lo active.
    inerte: true,
    async preview(ctx, args) {
      const rol = isAgentRole(args.rol) ? args.rol : 'general'
      const preset = roleTemplate(rol)
      const puede = preset
        ? Object.entries(preset.permissions)
            .filter(([, v]) => v)
            .map(([k]) => k.replace(/_/g, ' '))
            .join(', ')
        : 'lo que permita la tienda conectada'
      return `Crearía el agente «${args.nombre}» con rol ${rol}, pausado. Podría: ${puede}.`
    },
    run: crearBorrador,
  },

  {
    key: 'agentes.activar',
    description:
      'Prende o pausa un agente. Al prenderlo valida que no le dispute el canal a otro agente del mismo rol.',
    descriptionEn:
      'Turns an agent on or off. Turning it on checks that it does not compete for the channel with another agent of the same role.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        activo: { type: 'boolean' },
      },
      required: ['agent_id', 'activo'],
    },
    // Prenderlo lo pone a contestarle a clientes reales; pausarlo lo calla.
    inerte: (args) => args.activo === false,
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('ai_agents')
        .select('name')
        .eq('id', String(args.agent_id))
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      const nombre = (data as { name?: string } | null)?.name ?? 'ese agente'
      return args.activo !== false
        ? `Prendería «${nombre}». Empieza a contestarle a clientes reales.`
        : `Pausaría «${nombre}». Deja de contestar hasta que lo prendas.`
    },
    run: activarAgente,
  },
]
