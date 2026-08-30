import type { SupabaseClient } from '@supabase/supabase-js'
import { askForApproval } from '@/lib/approvals/ask'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { markOrderPaid } from '@/lib/shopify/mark-paid'
import {
  leerReglasDeCobro,
  REGLAS_POR_DEFECTO,
  type ReglasDeCobro,
} from './reglas-de-cobro'

/**
 * "Ya te transferí" — qué hacer con eso.
 *
 * Son dos decisiones, no una, y confundirlas es lo que hace que este problema
 * se resuelva mal en todos lados:
 *
 *   DEJAR DE INSISTIR es automático. Alcanza con que la persona lo diga. El
 *   daño de seguir mandándole recordatorios a quien ya pagó es inmediato y
 *   equivocarse callando no le cuesta nada a nadie: si no pagó, el pedido
 *   sigue pendiente y el comercio lo ve igual.
 *
 *   DAR POR COBRADO no. Marcar pagado un pedido que no se pagó termina en
 *   mercadería despachada de arriba. Se marca solo cuando el monto del
 *   comprobante coincide con lo que falta cobrar; si no coincide, o si no se
 *   pudo leer, se le pregunta a una persona.
 *
 * Lo primero pasa siempre. Lo segundo, sólo con certeza.
 */

/** Piso de la tolerancia: un centavo. Menos que esto es un redondeo del banco. */
const TOLERANCIA = 0.01

/**
 * ¿El comprobante alcanza para cobrar solo?
 *
 * Se exporta porque quien pregunta ANTES de ejecutar —la pantalla de
 * confirmación del chat agéntico— tiene que anticipar cuál de las dos ramas va
 * a pasar. Con la cuenta escrita dos veces, el aviso podría prometer "se marca
 * pagado" y terminar preguntándole a una persona.
 */
export function montoCoincide(
  totalDelPedido: string | number | null | undefined,
  montoDeclarado: number | null | undefined,
  toleranciaPct: number = REGLAS_POR_DEFECTO.toleranciaPct,
): boolean {
  const esperado = Number(totalDelPedido ?? '')
  const declarado = Number(montoDeclarado ?? NaN)
  return (
    Number.isFinite(esperado) &&
    Number.isFinite(declarado) &&
    Math.abs(esperado - declarado) <=
      Math.max(TOLERANCIA, (esperado * toleranciaPct) / 100)
  )
}

export type ReportOutcome =
  | { kind: 'cobrado'; amount: string }
  | { kind: 'a_confirmar'; reason: string; approvalId?: string }
  /**
   * Mandá el comprobante y su pedido YA estaba pagado.
   *
   * Caía en `sin_pedido` —la consulta descarta los pagados— y de ahí salía
   * "lo estamos verificando y te aviso", que es falso y además manda a una
   * persona a revisar algo que está resuelto. Visto el 2026-08-30: su pedido
   * figuraba pagado seis minutos ANTES de que mandara el comprobante.
   *
   * Es la respuesta más tranquilizadora que hay y la teníamos a mano.
   */
  | { kind: 'ya_pagado'; orderNumber: string | null; total: string | null; currency: string | null }
  | { kind: 'sin_pedido' }
  | { kind: 'error'; error: string }

export interface ReportedPaymentInput {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  /** Monto leído del comprobante. Sin esto nunca se marca solo. */
  amount?: number | null
  /** Fila de `messages` donde llegó, para poder volver a mirarlo. */
  messageId?: string | null
  /**
   * ¿El monto salió de un COMPROBANTE que la persona mandó, o de lo que
   * escribió? No es lo mismo y hasta ahora daba igual.
   */
  desdeComprobante?: boolean | null
  /** Número de operación del comprobante. Identifica UNA transferencia. */
  referencia?: string | null
  /** Lo demás que se leyó: fecha, banco, cuenta destino, titular. */
  leido?: Record<string, unknown> | null
  /**
   * Con qué pruebas se cobra solo en esta cuenta. Si no se pasan, se leen.
   * Se puede pasar para no volver a consultarlas cuando quien llama ya las
   * tiene —la pantalla que anticipa la rama, por ejemplo—.
   */
  reglas?: ReglasDeCobro | null
}

/** Ventana hacia atrás para buscar el archivo que la persona mandó. */
const VENTANA_COMPROBANTE_MS = 60 * 60 * 1000

/**
 * ¿Existe de verdad un comprobante en esta conversación?
 *
 * El modelo dice que leyó un monto; esto comprueba que había algo que leer. Sin
 * esta consulta, "ya te transferí 39990" escrito a mano alcanzaba para marcar
 * el pedido pagado — y con cuatro montos cubriendo el 79% de los pedidos, el
 * número correcto lo sabe cualquiera que vio el anuncio.
 */
async function hayComprobante(
  db: SupabaseClient,
  contactId: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - VENTANA_COMPROBANTE_MS).toISOString()
  const { data } = await db
    .from('messages')
    .select('id, conversations!inner(contact_id)')
    .eq('conversations.contact_id', contactId)
    .eq('sender_type', 'customer')
    .in('media_type', ['image', 'document'])
    .gte('created_at', desde)
    .limit(1)
  return ((data ?? []) as unknown[]).length > 0
}

/**
 * Anota que esta persona dijo que pagó y, si se puede, lo cobra.
 *
 * Devuelve qué pasó para que el agente se lo pueda contar al cliente sin
 * inventar: "ya lo tomamos" es distinto de "lo estamos verificando".
 */
export async function registerReportedPayment(
  input: ReportedPaymentInput,
): Promise<ReportOutcome> {
  const { db, workspaceId, contactId } = input
  const reglas = input.reglas ?? (await leerReglasDeCobro(db, workspaceId))

  // Los pedidos pendientes de esta persona. Se piden DOS a propósito: con más
  // de uno no hay forma de saber cuál pagó, y elegir "el más reciente" es
  // adivinar con la plata de otro. Ver el corte de ambigüedad más abajo.
  const { data: pendientes, error } = await db
    .from('orders')
    .select('id, shopify_order_id, order_number, total_price, currency, financial_status')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .neq('financial_status', 'paid')
    .order('created_at', { ascending: false })
    .limit(2)
  if (error) return { kind: 'error', error: error.message }
  const varios = ((pendientes ?? []) as unknown[]).length > 1
  const data = (pendientes ?? [])[0] ?? null
  const order = data as {
    id: string
    shopify_order_id: string | null
    order_number: string | null
    total_price: string | null
    currency: string | null
    financial_status: string | null
  } | null
  if (!order) {
    // Antes de decir "no encontramos tu pedido": mirar si lo que tiene es un
    // pedido YA PAGADO. Son dos respuestas opuestas y esto las separaba mal.
    const { data: pagado } = await db
      .from('orders')
      .select('order_number, total_price, currency')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .eq('financial_status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const fila = pagado as {
      order_number: string | null
      total_price: string | null
      currency: string | null
    } | null
    if (fila) {
      return {
        kind: 'ya_pagado',
        orderNumber: fila.order_number,
        total: fila.total_price,
        currency: fila.currency,
      }
    }
    return { kind: 'sin_pedido' }
  }

  // Paso 1, siempre: dejar de insistir. Se anota antes de intentar cobrar,
  // porque si Shopify falla la persona igual dejó de deber la conversación.
  const referencia = (input.referencia ?? '').trim() || null
  await db
    .from('orders')
    .update({
      payment_reported_at: new Date().toISOString(),
      payment_reported_amount: input.amount ?? null,
      payment_report_message_id: input.messageId ?? null,
      payment_evidence: {
        desde_comprobante: input.desdeComprobante === true,
        referencia,
        leido: input.leido ?? null,
        // Con qué reglas se decidió. Sin esto, auditar un cobro de hace tres
        // meses obliga a adivinar si en ese momento se exigía comprobante.
        reglas,
        anotado_en: new Date().toISOString(),
      },
    })
    .eq('id', order.id)

  // Paso 2: ¿alcanza para cobrar solo?
  const esperado = Number(order.total_price ?? '')
  const declarado = Number(input.amount ?? NaN)

  if (!montoCoincide(order.total_price, input.amount, reglas.toleranciaPct)) {
    const motivo = !Number.isFinite(declarado)
      ? 'no se pudo leer el monto del comprobante'
      : `el comprobante dice ${declarado} y el pedido es de ${esperado}`
    return { kind: 'a_confirmar', reason: motivo }
  }

  // ── Lo que el monto no alcanza a probar ────────────────────────────────
  //
  // El monto coincide, y eso sirve mucho menos de lo que parece: en Pilar,
  // cuatro montos cubren el 79% de 558 pedidos y el precio está en el anuncio.
  // Coincidir es casi la norma, no una prueba. Estos tres cortes son lo que
  // convierte "coincide" en "consta" — y cuáles se exigen lo decide el comercio
  // (`reglas-de-cobro.ts`), porque en un negocio de presupuestos únicos el
  // monto sí identifica la transferencia.

  // 1. Que haya un comprobante DE VERDAD. El modelo puede leer el monto del
  //    mensaje escrito ("ya te transferí 39990") en vez de una imagen: eso es
  //    una afirmación del cliente, no un comprobante.
  if (
    reglas.exigeComprobante &&
    (input.desdeComprobante !== true || !(await hayComprobante(db, contactId)))
  ) {
    return {
      kind: 'a_confirmar',
      reason: 'dijo el monto pero no hay un comprobante que lo respalde',
    }
  }

  // 2. Un solo pedido pendiente. Con dos, el monto no dice cuál pagó —y con
  //    precios repetidos, menos todavía.
  if (reglas.unSoloPendiente && varios) {
    return {
      kind: 'a_confirmar',
      reason: 'tiene más de un pedido pendiente y no se sabe cuál pagó',
    }
  }

  // 3. Ese comprobante no pagó ya otra cosa. Sin la referencia no hay forma de
  //    saberlo, así que sin referencia tampoco se cobra solo: la misma captura
  //    reenviada dos veces pagaría dos pedidos.
  if (reglas.exigeReferencia && !referencia) {
    return {
      kind: 'a_confirmar',
      reason: 'no se pudo leer el número de operación del comprobante',
    }
  }
  // La comprobación de reuso corre SIEMPRE que haya número, la exija el
  // comercio o no: aflojar el requisito es aceptar cobros sin número, nunca
  // aceptar dos veces el mismo.
  if (referencia) {
    const { data: yaUsada } = await db
      .from('orders')
      .select('id, order_number')
      .eq('workspace_id', workspaceId)
      .eq('payment_reference', referencia)
      .neq('id', order.id)
      .limit(1)
      .maybeSingle()
    if (yaUsada) {
      const otra = (yaUsada as { order_number?: string | null }).order_number
      return {
        kind: 'a_confirmar',
        reason: `ese comprobante ya se usó para el pedido ${otra ?? 'anterior'}`,
      }
    }
  }

  if (!order.shopify_order_id) {
    return { kind: 'a_confirmar', reason: 'el pedido no está en Shopify' }
  }

  const admin = await resolveShopifyAdmin(db, workspaceId)
  if (!admin) return { kind: 'a_confirmar', reason: 'la tienda no está conectada' }

  const res = await markOrderPaid(admin, order.shopify_order_id)
  if (!res.ok) {
    return { kind: 'a_confirmar', reason: res.error ?? 'Shopify no aceptó el cobro' }
  }

  await db
    .from('orders')
    .update({
      financial_status: res.financialStatus ?? 'paid',
      payment_report_outcome: 'automatico',
      // La referencia se sella recién ACÁ, cuando el cobro salió: guardarla
      // antes quemaría el número en un pedido que no se llegó a cobrar y el
      // índice único dejaría al cliente sin poder usar su propio comprobante.
      payment_reference: referencia,
    })
    .eq('id', order.id)

  return { kind: 'cobrado', amount: res.amount ?? String(esperado) }
}

/** Datos del pedido pendiente, para armar el aviso que va al comercio. */
export interface PedidoPendiente {
  id: string
  orderNumber: string | null
  total: string | null
  currency: string | null
  shopifyOrderId: string | null
}

export async function pendingOrderFor(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<PedidoPendiente | null> {
  const { data } = await db
    .from('orders')
    .select('id, order_number, total_price, currency, shopify_order_id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .neq('financial_status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as {
    id: string
    order_number: string | null
    total_price: string | null
    currency: string | null
    shopify_order_id: string | null
  } | null
  if (!row) return null
  return {
    id: row.id,
    orderNumber: row.order_number,
    total: row.total_price,
    currency: row.currency,
    shopifyOrderId: row.shopify_order_id,
  }
}

export interface PagoInformado {
  resultado: ReportOutcome
  /** El pedido sobre el que quedó la duda. Sólo cuando hay que preguntar. */
  pedido: PedidoPendiente | null
  approvalId?: string
}

/**
 * Lo mismo que `registerReportedPayment`, más el paso que le faltaba: cuando no
 * alcanza para cobrar solo, preguntarle a una persona del negocio.
 *
 * Las dos mitades estaban separadas — registrar acá, preguntar en la tool del
 * agente— y eso dejaba la mitad peligrosa afuera de la librería: cualquier
 * segundo llamador que registrara un pago sin acordarse de pedir la aprobación
 * dejaría el comprobante dudoso esperando a nadie, con los recordatorios ya
 * apagados. Quien informa un pago llama esto y no la mitad de abajo.
 */
export async function informarPago(
  input: ReportedPaymentInput & { note?: string | null },
): Promise<PagoInformado> {
  const resultado = await registerReportedPayment(input)
  if (resultado.kind !== 'a_confirmar') return { resultado, pedido: null }

  const pedido = await pendingOrderFor(input.db, input.workspaceId, input.contactId)
  // Con los datos del comprobante EN el aviso.
  //
  // Quien aprueba decide sobre plata, y antes recibía "un cliente dice que ya
  // pagó": para resolverlo había que abrir la conversación, encontrar la
  // imagen y leerla. Ahora va lo que se leyó y por qué no se cobró solo, que
  // es exactamente lo que hace falta para decir sí o no.
  const leido = (input.leido ?? {}) as Record<string, unknown>
  const detalle = [
    input.referencia ? `operación ${input.referencia}` : null,
    leido.fecha ? `del ${String(leido.fecha)}` : null,
    leido.destino ? `a ${String(leido.destino)}` : null,
    leido.titular ? `de ${String(leido.titular)}` : null,
    input.desdeComprobante === true ? 'leído de un comprobante' : 'lo dijo por escrito',
  ]
    .filter(Boolean)
    .join(' · ')
  const aviso = await askForApproval({
    db: input.db,
    workspaceId: input.workspaceId,
    kind: 'pago_informado',
    title: `Pago informado — pedido ${pedido?.orderNumber ?? 's/n'}`,
    body:
      `Un cliente dice que ya pagó ${pedido?.total ?? ''} ${pedido?.currency ?? ''}. ` +
      `${input.note ?? ''} (${resultado.reason}). ${detalle}. ` +
      `¿Lo marco como pagado en Shopify?`,
    payload: {
      order_id: pedido?.id,
      shopify_order_id: pedido?.shopifyOrderId,
      contact_id: input.contactId,
      referencia: input.referencia ?? null,
      desde_comprobante: input.desdeComprobante === true,
      leido: input.leido ?? null,
    },
  })

  return { resultado, pedido, approvalId: aviso.approvalId }
}
