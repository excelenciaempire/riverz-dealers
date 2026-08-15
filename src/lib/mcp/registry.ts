import { supabaseAdmin } from '@/lib/automations/admin-client'
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule'
import { decidir } from '@/lib/approvals/resolve'

/**
 * Las herramientas que la operación expone a un agente.
 *
 * No son un CRUD de tablas: son las preguntas y las acciones que uno
 * realmente necesita cuando algo no salió. "¿Por qué no le llegó el mensaje a
 * esta persona?" es una herramienta; "SELECT sobre messages" no.
 *
 * Cada una declara su riesgo, y de eso depende si se ejecuta sola:
 *
 *   lectura       — no cambia nada, se ejecuta siempre.
 *   reversible    — cambia algo que se puede deshacer (prender, pausar,
 *                   correr un cron). Se ejecuta sola.
 *   irreversible  — le llega a una persona, o no se puede deshacer. NO se
 *                   ejecuta: devuelve qué haría y espera confirmación.
 */

export type Risk = 'lectura' | 'reversible' | 'irreversible'

export interface McpTool {
  name: string
  description: string
  risk: Risk
  schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  run: (args: Record<string, unknown>) => Promise<unknown>
  /** Qué se le muestra a la persona antes de ejecutar una irreversible. */
  preview?: (args: Record<string, unknown>) => Promise<string>
}

const db = () => supabaseAdmin()

function ws(args: Record<string, unknown>): string {
  const v = String(args.workspace_id ?? '')
  if (!v) throw new Error('falta workspace_id: toda herramienta opera sobre una cuenta')
  return v
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'cuentas_listar',
    description:
      'Lista las cuentas (workspaces) vivas con su nombre, cuántos contactos y canales tienen, y cuántas automatizaciones activas. Es el punto de entrada: el workspace_id que devuelve se usa en todas las demás.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    async run() {
      const { data } = await db()
        .from('workspaces')
        .select('id, name, created_at')
        .is('deleted_at', null)
        .order('created_at')
      const cuentas = (data ?? []) as { id: string; name: string; created_at: string }[]
      return Promise.all(
        cuentas.map(async (w) => {
          const [contactos, canales, autos] = await Promise.all([
            db().from('contacts').select('id', { count: 'exact', head: true }).eq('workspace_id', w.id),
            db()
              .from('channel_connections')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', w.id)
              .eq('status', 'connected'),
            db()
              .from('automations')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', w.id)
              .eq('is_active', true)
              .is('deleted_at', null),
          ])
          return {
            workspace_id: w.id,
            nombre: w.name,
            contactos: contactos.count ?? 0,
            canales_conectados: canales.count ?? 0,
            automatizaciones_activas: autos.count ?? 0,
          }
        }),
      )
    },
  },

  {
    name: 'operacion_estado',
    description:
      'Panorama de una cuenta: canales conectados, automatizaciones activas con su última corrida, mensajes enviados hoy, crons que fallaron y decisiones esperando aprobación.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { workspace_id: { type: 'string' } },
      required: ['workspace_id'],
    },
    async run(args) {
      const id = ws(args)
      const desdeHoy = new Date(Date.now() - 24 * 3_600_000).toISOString()
      const [canales, autos, enviados, crons, aprobaciones] = await Promise.all([
        db()
          .from('channel_connections')
          .select('channel, status, label')
          .eq('workspace_id', id)
          .neq('status', 'disconnected'),
        db()
          .from('automations')
          .select('id, name, trigger_type, is_active, execution_count, last_executed_at')
          .eq('workspace_id', id)
          .is('deleted_at', null),
        db()
          .from('automation_logs')
          .select('status')
          .eq('workspace_id', id)
          .gte('created_at', desdeHoy),
        db()
          .from('cron_runs')
          .select('name, status, started_at, error')
          .neq('status', 'ok')
          .gte('started_at', desdeHoy)
          .order('started_at', { ascending: false })
          .limit(10),
        db()
          .from('approval_requests')
          .select('id, kind, title, created_at')
          .eq('workspace_id', id)
          .eq('status', 'pendiente'),
      ])
      const logs = (enviados.data ?? []) as { status: string }[]
      return {
        canales: canales.data ?? [],
        automatizaciones: autos.data ?? [],
        corridas_24h: {
          total: logs.length,
          exito: logs.filter((l) => l.status === 'success').length,
          parciales: logs.filter((l) => l.status === 'partial').length,
          fallidas: logs.filter((l) => l.status === 'failed').length,
        },
        crons_con_error: crons.data ?? [],
        esperando_aprobacion: aprobaciones.data ?? [],
      }
    },
  },

  {
    name: 'por_que_no_salio',
    description:
      'Explica por qué una persona no recibió un mensaje. Recibe un teléfono y devuelve: si está dada de baja, qué automatizaciones corrieron para ese contacto y con qué resultado, qué barrera lo frenó, y los mensajes que sí salieron. Es la herramienta de diagnóstico.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        telefono: { type: 'string', description: 'Con o sin +, se compara por los últimos 8 dígitos.' },
        dias: { type: 'number', description: 'Cuántos días hacia atrás mirar. Por defecto 7.' },
      },
      required: ['workspace_id', 'telefono'],
    },
    async run(args) {
      const id = ws(args)
      const ultimos8 = String(args.telefono ?? '').replace(/\D/g, '').slice(-8)
      const desde = new Date(
        Date.now() - (Number(args.dias) || 7) * 86_400_000,
      ).toISOString()

      const { data: contactos } = await db()
        .from('contacts')
        .select('id, name, phone, opted_out, opted_out_at, opted_out_reason, last_inbound_at')
        .eq('workspace_id', id)
        .like('phone', `%${ultimos8}`)
      const encontrados = (contactos ?? []) as {
        id: string
        name: string | null
        phone: string
        opted_out: boolean
        opted_out_at: string | null
        opted_out_reason: string | null
        last_inbound_at: string | null
      }[]
      if (encontrados.length === 0) {
        return { encontrado: false, nota: 'No hay ningún contacto con ese teléfono en esta cuenta.' }
      }

      const ids = encontrados.map((c) => c.id)
      const [corridas, mensajes] = await Promise.all([
        db()
          .from('automation_logs')
          .select('created_at, status, trigger_event, steps_executed, error_message')
          .in('contact_id', ids)
          .gte('created_at', desde)
          .order('created_at', { ascending: false }),
        db()
          .from('messages')
          .select('created_at, template_name, status, error_code, error_reason, origin_name')
          .in(
            'conversation_id',
            ((
              await db().from('conversations').select('id').in('contact_id', ids)
            ).data ?? []).map((c: { id: string }) => c.id),
          )
          .neq('sender_type', 'customer')
          .gte('created_at', desde)
          .order('created_at', { ascending: false })
          .limit(30),
      ])

      return {
        encontrado: true,
        contactos: encontrados,
        // Lo primero que hay que mirar: una baja explica todo lo demás.
        dado_de_baja: encontrados.some((c) => c.opted_out),
        corridas: corridas.data ?? [],
        mensajes: mensajes.data ?? [],
      }
    },
  },

  {
    name: 'automatizacion_activar',
    description: 'Prende o pausa una automatización. Se deshace llamando de nuevo.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        automation_id: { type: 'string' },
        activa: { type: 'boolean' },
      },
      required: ['workspace_id', 'automation_id', 'activa'],
    },
    async run(args) {
      const { data, error } = await db()
        .from('automations')
        .update({ is_active: Boolean(args.activa) })
        .eq('id', String(args.automation_id))
        .eq('workspace_id', ws(args))
        .select('id, name, is_active')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('esa automatización no existe en esta cuenta')
      return data
    },
  },

  {
    name: 'automatizacion_editar_espera',
    description:
      'Cambia cuánto espera un paso de espera. El paso se identifica por su id, que sale de operacion_estado o del lienzo.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        step_id: { type: 'string' },
        amount: { type: 'number' },
        unit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
      },
      required: ['workspace_id', 'step_id', 'amount', 'unit'],
    },
    async run(args) {
      const { data: paso } = await db()
        .from('automation_steps')
        .select('id, automation_id, step_type, automations!inner(workspace_id)')
        .eq('id', String(args.step_id))
        .maybeSingle()
      const fila = paso as
        | { id: string; step_type: string; automations?: { workspace_id?: string } }
        | null
      if (!fila) throw new Error('ese paso no existe')
      if (fila.automations?.workspace_id !== ws(args)) {
        throw new Error('ese paso es de otra cuenta')
      }
      if (fila.step_type !== 'wait') throw new Error('ese paso no es una espera')
      const { data, error } = await db()
        .from('automation_steps')
        .update({ step_config: { amount: Number(args.amount), unit: String(args.unit) } })
        .eq('id', fila.id)
        .select('id, step_config')
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data
    },
  },

  {
    name: 'cron_estado',
    description:
      'Los trabajos programados: nombre, frecuencia y cómo terminó la última corrida de cada uno.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    async run() {
      // El mismo RPC que mira el panel, y no un reduce propio sobre una ventana
      // de 24 h: así la respuesta del agente y la pantalla no se contradicen, y
      // los trabajos diarios no desaparecen por quedar fuera de la ventana.
      const { data } = await db().rpc('admin_cron_health')
      const ultima = new Map<string, unknown>()
      for (const r of (data ?? []) as { name: string }[]) {
        ultima.set(r.name, r)
      }
      return SCHEDULED_JOBS.map((j) => ({
        nombre: j.name,
        frecuencia: j.schedule,
        disparado_por: j.parent ?? 'reloj',
        atrasado: isStale(j.schedule, (ultima.get(j.name) as { started_at?: string } | undefined)?.started_at ?? null),
        ultima_corrida: ultima.get(j.name) ?? null,
      }))
    },
  },

  {
    name: 'aprobacion_decidir',
    description:
      'Aprueba o rechaza una decisión que estaba esperando (las que devuelve operacion_estado). Aprobar ejecuta lo que estaba pendiente.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        approval_id: { type: 'string' },
        aprobar: { type: 'boolean' },
      },
      required: ['workspace_id', 'approval_id', 'aprobar'],
    },
    async run(args) {
      return decidir(db(), {
        approvalId: String(args.approval_id),
        decision: args.aprobar ? 'aprobada' : 'rechazada',
        via: 'panel',
        // El workspace no es decorativo: sin él, un id suelto aprueba algo de
        // otra cuenta, y aprobar cobra un pedido en Shopify.
        workspaceId: ws(args),
      })
    },
  },

  {
    name: 'mensaje_enviar',
    description:
      'Manda un mensaje de WhatsApp a un contacto de la cuenta. Le llega a una persona real, así que primero devuelve qué haría y espera confirmación.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        contact_id: { type: 'string' },
        texto: { type: 'string' },
      },
      required: ['workspace_id', 'contact_id', 'texto'],
    },
    async preview(args) {
      const { data } = await db()
        .from('contacts')
        .select('name, phone, opted_out')
        .eq('id', String(args.contact_id))
        .eq('workspace_id', ws(args))
        .maybeSingle()
      const c = data as { name?: string; phone?: string; opted_out?: boolean } | null
      if (!c) return 'Ese contacto no existe en esta cuenta.'
      const baja = c.opted_out ? ' — OJO: pidió la baja, el envío se va a frenar' : ''
      return `Le mandaría a ${c.name ?? 'sin nombre'} (${c.phone}): "${args.texto}"${baja}`
    },
    async run(args) {
      const { engineSendText } = await import('@/lib/automations/meta-send')
      const { data: conv } = await db()
        .from('conversations')
        .select('id')
        .eq('contact_id', String(args.contact_id))
        .eq('workspace_id', ws(args))
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!conv) throw new Error('ese contacto no tiene conversación abierta')
      return engineSendText({
        workspaceId: ws(args),
        conversationId: (conv as { id: string }).id,
        contactId: String(args.contact_id),
        text: String(args.texto),
        automationName: 'MCP',
        reason: 'asistente',
      })
    },
  },
]

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}
