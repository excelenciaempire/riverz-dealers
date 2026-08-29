/**
 * Decisiones que están esperando a una persona.
 *
 * El `decidir` de abajo es el mismo que usan el panel, el webhook de WhatsApp
 * y el componente del dashboard. Su UPDATE condicionado a `status='pendiente'`
 * es lo que evita que dos respuestas ejecuten la misma acción dos veces — y
 * aprobar ejecuta de verdad: marca un pedido como pagado en Shopify.
 */
import { decidir } from '@/lib/approvals/resolve'
import type { Capability, CapabilityContext } from './types'
import type { Artefacto } from '@/lib/operator/artifacts'
import { cambio, corto, fecha, lista, tabla, tt } from './vistas'

async function pendientes(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('approval_requests')
    .select('id, kind, title, payload, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .eq('status', 'pendiente')
    .order('created_at', { ascending: true })
    .limit(50)
  return data ?? []
}

/**
 * Lo que espera una decisión.
 *
 * Cada fila es algo que no va a pasar hasta que alguien apriete un botón. Lo
 * que hace falta ver es qué es y desde cuándo espera — un pedido esperando
 * aprobación desde hace tres días es un cliente que no recibió nada.
 */
function vistaPendientesAprobacion(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{ kind: string; title: string | null; created_at: string }>(r)
  return tabla({
    titulo: tt(ctx, 'operation.vEsperandoAprobacion'),
    columnas: [
      { clave: 'que', titulo: tt(ctx, 'operation.vColQue') },
      { clave: 'tipo', titulo: tt(ctx, 'operation.vColTipo') },
      { clave: 'desde', titulo: tt(ctx, 'operation.vColCuando') },
    ],
    filas: filas.map((a) => ({
      que: corto(a.title, 50),
      tipo: corto(a.kind, 20),
      desde: fecha(ctx, a.created_at),
    })),
    vacio: tt(ctx, 'operation.vSinAprobaciones'),
  })
}

/**
 * Decidir lo que estaba esperando.
 *
 * Aprobar EJECUTA lo que estaba pendiente, y eso puede cobrar un pedido. La
 * tarjeta lo dice, porque «aprobar» a secas se lee como un trámite.
 */
function vistaDecidir(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const aprueba = args.aprobar === true || args.decision === 'aprobar'
  return cambio({
    titulo: tt(ctx, 'operation.vEsperandoAprobacion'),
    que: tt(ctx, aprueba ? 'operation.vQueAprobar' : 'operation.vQueRechazar'),
    aviso: aprueba ? tt(ctx, 'operation.vAprobarAviso') : undefined,
  })
}

export const APPROVAL_CAPABILITIES: Capability[] = [
  {
    key: 'aprobaciones.pendientes',
    description:
      'Las decisiones que están esperando que alguien apruebe o rechace, con lo que haría cada una.',
    descriptionEn:
      'The decisions waiting for someone to approve or reject, with what each one would do.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: pendientes,
    vista: (ctx, _args, r) => vistaPendientesAprobacion(ctx, r),
  },

  {
    key: 'aprobaciones.decidir',
    description:
      'Aprueba o rechaza una decisión que estaba esperando. Aprobar ejecuta lo que estaba pendiente: puede cobrar un pedido.',
    descriptionEn:
      'Approves or rejects a decision that was waiting. Approving executes whatever was pending: it may charge an order.',
    // Irreversible y no reversible como la tenía el MCP: aprobar marca un
    // pedido como pagado en Shopify, y eso no se deshace llamando de nuevo.
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        approval_id: { type: 'string' },
        aprobar: { type: 'boolean' },
      },
      required: ['approval_id', 'aprobar'],
    },
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('approval_requests')
        .select('title, kind, status')
        .eq('id', String(args.approval_id))
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      const a = data as { title?: string; kind?: string; status?: string } | null
      if (!a) throw new Error('Esa decisión no existe en esta cuenta.')
      if (a.status !== 'pendiente') throw new Error(`Esa decisión ya está ${a.status}.`)
      return args.aprobar
        ? `Aprobaría "${a.title}" (${a.kind}) y se ejecutaría ahora.`
        : `Rechazaría "${a.title}" (${a.kind}) y no se haría nada.`
    },
    async run(ctx, args) {
      return decidir(ctx.db, {
        approvalId: String(args.approval_id),
        decision: args.aprobar ? 'aprobada' : 'rechazada',
        via: 'panel',
        decidedBy: ctx.actor.id ?? null,
        // Sin la cuenta, un id suelto alcanza para aprobar algo de otra.
        workspaceId: ctx.workspaceId,
      })
    },
    artifact: (ctx, args) => vistaDecidir(ctx, args),
  },
]
