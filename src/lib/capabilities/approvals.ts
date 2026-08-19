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
      if (!a) return 'Esa decisión no existe en esta cuenta.'
      if (a.status !== 'pendiente') return `Esa decisión ya está ${a.status}.`
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
  },
]
