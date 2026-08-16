import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { McpTool } from './registry'

/**
 * Las herramientas del COMERCIO.
 *
 * Las de `registry.ts` nacieron para el equipo de Riverz: son de diagnóstico
 * —"¿por qué no le llegó el mensaje a esta persona?"— y sirven cuando ya sabés
 * que algo se rompió. Un comercio llega con otras preguntas, y son las de todos
 * los días: quién me escribió y nadie contestó, quién es este cliente, cómo
 * vengo, qué plantilla tengo trabada, cómo salió la campaña.
 *
 * Mismo criterio que el otro archivo: no es un CRUD de tablas. Cada herramienta
 * contesta una pregunta que alguien se hace en voz alta, y devuelve lo que se
 * necesita para actuar, no todas las columnas.
 *
 * Sobre los datos personales: acá SÍ salen nombres y teléfonos. Son los
 * clientes del comercio que está preguntando, con su propia llave, sobre su
 * propia cuenta. Es lo contrario del panel de plataforma, que mira cuentas
 * ajenas y por eso no puede verlos.
 */

const db = () => supabaseAdmin()

function ws(args: Record<string, unknown>): string {
  const v = String(args.workspace_id ?? '')
  if (!v) throw new Error('falta workspace_id: toda herramienta opera sobre una cuenta')
  return v
}

/** Cuántos días atrás mirar, acotado para que una pregunta no barra la base. */
function dias(args: Record<string, unknown>, def = 7, max = 90): number {
  const n = Number(args.dias)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(Math.floor(n), max)
}

function desde(d: number): string {
  return new Date(Date.now() - d * 86_400_000).toISOString()
}

export const MERCHANT_TOOLS: McpTool[] = [
  {
    name: 'conversaciones_pendientes',
    description:
      'Las conversaciones que están esperando una respuesta: alguien escribió y nadie contestó, o la IA pidió que intervenga una persona. Es la primera pregunta de la mañana.',
    descriptionEn:
      'The conversations waiting for a reply: someone wrote and nobody answered, or the AI asked for a human. It is the first question of the morning.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        limite: { type: 'number', description: 'Cuántas traer. Por defecto 20.' },
      },
      required: ['workspace_id'],
    },
    async run(args) {
      const id = ws(args)
      const limite = Math.min(Number(args.limite) || 20, 100)

      const { data } = await db()
        .from('conversations')
        .select(
          'id, channel, status, last_message_at, last_sender_type, unread_count, needs_human_reason, needs_human_at, contacts(name, phone)',
        )
        .eq('workspace_id', id)
        .is('deleted_at', null)
        .neq('status', 'closed')
        // Lo que define "pendiente": el último que habló fue el cliente. Si
        // contestó el negocio, la pelota no está de este lado.
        .eq('last_sender_type', 'customer')
        .order('last_message_at', { ascending: true })
        .limit(limite)

      const filas = (data ?? []) as unknown as Array<{
        id: string
        channel: string
        status: string
        last_message_at: string | null
        unread_count: number | null
        needs_human_reason: string | null
        needs_human_at: string | null
        contacts: { name: string | null; phone: string | null } | null
      }>

      return filas.map((c) => ({
        conversation_id: c.id,
        canal: c.channel,
        contacto: c.contacts?.name ?? c.contacts?.phone ?? 'sin nombre',
        telefono: c.contacts?.phone ?? null,
        // Horas esperando: es el número que decide a quién atender primero.
        horas_esperando: c.last_message_at
          ? Math.round((Date.now() - Date.parse(c.last_message_at)) / 3_600_000)
          : null,
        sin_leer: c.unread_count ?? 0,
        pidio_humano: c.needs_human_reason,
      }))
    },
  },

  {
    name: 'contacto_buscar',
    description:
      'Busca un cliente por teléfono, nombre o correo y devuelve su ficha: etiquetas, si pidió la baja, cuándo escribió por última vez, sus pedidos y qué le interesó. Sirve para contestar "¿quién es este?" antes de escribirle.',
    descriptionEn:
      'Finds a customer by phone, name or email and returns their record: tags, whether they opted out, when they last wrote, their orders and what caught their interest. Answers “who is this?” before writing to them.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        busqueda: { type: 'string', description: 'Teléfono, nombre o correo.' },
      },
      required: ['workspace_id', 'busqueda'],
    },
    async run(args) {
      const id = ws(args)
      const q = String(args.busqueda ?? '').trim()
      if (!q) throw new Error('falta qué buscar')

      // Un teléfono se compara por los últimos 8 dígitos: lo que guarda la base
      // y lo que escribe una persona casi nunca coinciden en el prefijo.
      const soloDigitos = q.replace(/\D/g, '')
      const porTelefono = soloDigitos.length >= 6
      const filtro = porTelefono
        ? `phone.like.%${soloDigitos.slice(-8)},name.ilike.%${q}%`
        : `name.ilike.%${q}%,email.ilike.%${q}%`

      const { data } = await db()
        .from('contacts')
        .select(
          'id, name, phone, email, opted_out, opted_out_reason, last_inbound_at, ai_segment, last_product, last_offer_chosen, created_at',
        )
        .eq('workspace_id', id)
        .or(filtro)
        .limit(10)

      const contactos = (data ?? []) as Array<{ id: string; name: string | null }>
      if (contactos.length === 0) return { encontrados: 0, contactos: [] }

      const ids = contactos.map((c) => c.id)
      const [etiquetas, pedidos] = await Promise.all([
        db()
          .from('contact_tags')
          .select('contact_id, tags(name)')
          .in('contact_id', ids),
        db()
          .from('orders')
          .select('contact_id, order_number, total_price, currency, financial_status, created_at')
          .eq('workspace_id', id)
          .in('contact_id', ids)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      const porContacto = new Map<string, string[]>()
      for (const t of ((etiquetas.data ?? []) as unknown as Array<{
        contact_id: string
        tags: { name: string } | { name: string }[] | null
      }>)) {
        const tag = Array.isArray(t.tags) ? t.tags[0] : t.tags
        if (!tag) continue
        porContacto.set(t.contact_id, [...(porContacto.get(t.contact_id) ?? []), tag.name])
      }

      const pedidosDe = new Map<string, unknown[]>()
      for (const p of ((pedidos.data ?? []) as Array<{ contact_id: string }>)) {
        pedidosDe.set(p.contact_id, [...(pedidosDe.get(p.contact_id) ?? []), p])
      }

      return {
        encontrados: contactos.length,
        contactos: contactos.map((c) => ({
          ...c,
          etiquetas: porContacto.get(c.id) ?? [],
          pedidos: pedidosDe.get(c.id) ?? [],
        })),
      }
    },
  },

  {
    name: 'metricas',
    description:
      'Cómo viene la cuenta en un período: mensajes que entraron y salieron, cuántos contestó la IA, contactos nuevos, pedidos y cuánto facturaron. Es el "¿cómo vamos?".',
    descriptionEn:
      'How the account is doing over a period: messages in and out, how many the AI answered, new contacts, orders and revenue. The “how are we doing?”.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 7, máximo 90.' },
      },
      required: ['workspace_id'],
    },
    async run(args) {
      const id = ws(args)
      const d = dias(args)
      const from = desde(d)

      const [entrantes, salientes, ia, contactos, pedidos] = await Promise.all([
        db()
          .from('messages')
          .select('id, conversations!inner(workspace_id)', { count: 'exact', head: true })
          .eq('conversations.workspace_id', id)
          .eq('sender_type', 'customer')
          .gte('created_at', from),
        db()
          .from('messages')
          .select('id, conversations!inner(workspace_id)', { count: 'exact', head: true })
          .eq('conversations.workspace_id', id)
          .in('sender_type', ['agent', 'bot'])
          .gte('created_at', from),
        db()
          .from('ai_replies')
          .select('status')
          .eq('workspace_id', id)
          .gte('created_at', from),
        db()
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', id)
          .gte('created_at', from),
        db()
          .from('orders')
          .select('total_price, currency, financial_status')
          .eq('workspace_id', id)
          .gte('created_at', from),
      ])

      const replies = (ia.data ?? []) as { status: string }[]
      const ords = (pedidos.data ?? []) as {
        total_price: number | string | null
        currency: string | null
      }[]
      const facturado = ords.reduce((a, o) => a + (Number(o.total_price) || 0), 0)

      return {
        periodo_dias: d,
        mensajes_entrantes: entrantes.count ?? 0,
        mensajes_salientes: salientes.count ?? 0,
        ia: {
          respondio: replies.filter((r) => r.status === 'sent').length,
          se_abstuvo: replies.filter((r) => r.status === 'skipped').length,
          fallo: replies.filter((r) => r.status === 'failed').length,
        },
        contactos_nuevos: contactos.count ?? 0,
        pedidos: ords.length,
        facturado: Number(facturado.toFixed(2)),
        moneda: ords[0]?.currency ?? null,
      }
    },
  },

  {
    name: 'plantillas_estado',
    description:
      'Las plantillas de WhatsApp con su estado en Meta y el motivo de rechazo cuando lo hay. Una rechazada no se puede usar en ninguna campaña ni automatización, así que suele ser la causa de que algo no salga.',
    descriptionEn:
      'The WhatsApp templates with their status at Meta and the rejection reason when there is one. A rejected template cannot be used in any campaign or automation, so it is often the reason something does not go out.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { workspace_id: { type: 'string' } },
      required: ['workspace_id'],
    },
    async run(args) {
      const { data } = await db()
        .from('message_templates')
        .select('name, category, language, status, rejected_reason, quality_score, updated_at')
        .eq('workspace_id', ws(args))
        .order('updated_at', { ascending: false })
        .limit(100)

      const filas = (data ?? []) as Array<{ status: string | null; name: string }>
      const rechazadas = filas.filter((t) => (t.status ?? '').toLowerCase() === 'rejected')
      const pendientes = filas.filter((t) => (t.status ?? '').toLowerCase() === 'pending')

      return {
        total: filas.length,
        // Se destacan porque son las accionables: una rechazada hay que
        // corregirla y una que lleva días en pendiente suele ser el WABA
        // bloqueado por facturación, no la plantilla.
        rechazadas: rechazadas.length,
        pendientes: pendientes.length,
        plantillas: filas,
      }
    },
  },

  {
    name: 'campanas_estado',
    description:
      'Las campañas y cómo terminaron: a cuántos salió, cuántos la recibieron, cuántos contestaron y cuántas fallaron. Incluye las que quedaron trabadas en "enviando".',
    descriptionEn:
      'The campaigns and how they ended: how many were targeted, how many received it, how many replied and how many failed. Includes the ones stuck in “sending”.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 30, máximo 90.' },
      },
      required: ['workspace_id'],
    },
    async run(args) {
      const d = dias(args, 30)
      const { data } = await db()
        .from('broadcasts')
        .select(
          'id, name, template_name, status, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count, scheduled_at, error_message, created_at, updated_at',
        )
        .eq('workspace_id', ws(args))
        .gte('created_at', desde(d))
        .order('created_at', { ascending: false })
        .limit(50)

      const filas = (data ?? []) as Array<{
        status: string
        updated_at: string
        failed_count: number | null
      }>
      const dosHoras = Date.now() - 2 * 3_600_000
      return {
        periodo_dias: d,
        // "Enviando" hace más de dos horas ya no está enviando: está trabada.
        trabadas: filas.filter(
          (b) => b.status === 'sending' && Date.parse(b.updated_at) < dosHoras,
        ).length,
        campanas: data ?? [],
      }
    },
  },

  {
    name: 'pedidos_listar',
    description:
      'Los pedidos de la cuenta con su estado de pago y de envío, incluido el seguimiento cuando existe. Sirve para contestarle a un cliente dónde está lo suyo.',
    descriptionEn:
      'The orders of the account with their payment and shipping status, including tracking when it exists. Useful for telling a customer where their package is.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 30, máximo 90.' },
        estado_pago: {
          type: 'string',
          description: 'Filtrar por estado de pago, p. ej. "pending" o "paid".',
        },
      },
      required: ['workspace_id'],
    },
    async run(args) {
      const d = dias(args, 30)
      let q = db()
        .from('orders')
        .select(
          'order_number, customer_name, customer_phone, total_price, currency, financial_status, fulfillment_status, shipping_status, tracking_number, tracking_url, channel, created_at',
        )
        .eq('workspace_id', ws(args))
        .gte('created_at', desde(d))
        .order('created_at', { ascending: false })
        .limit(100)
      if (args.estado_pago) q = q.eq('financial_status', String(args.estado_pago))

      const { data } = await q
      return { periodo_dias: d, pedidos: data ?? [] }
    },
  },
]
