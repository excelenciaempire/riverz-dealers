/**
 * Cómo se lee, en un WhatsApp, lo que el agente quiere hacer.
 *
 * El comercio decide con el teléfono en la mano, casi siempre caminando. Lo que
 * le llega tiene que alcanzar para decir sí o no sin abrir la app: qué se va a
 * hacer, sobre qué, y por cuánta plata. Un volcado del JSON de la herramienta
 * no sirve — nadie aprueba `{"amount":20000,"order_number":"1042"}`.
 *
 * El tercer campo es para el modelo: qué contarle a la clienta mientras espera.
 * Sin eso, el agente se inventa una confirmación que todavía no existe, que es
 * el error caro de todo este camino.
 */

export interface ResumenHerramienta {
  titulo: string
  cuerpo: string
  comoContarlo: string
}

function texto(v: unknown, max = 120): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const ESPERA =
  'Dile que ya lo pasaste al equipo y que le confirmas apenas esté. ' +
  'NO le digas que ya está hecho ni le prometas una fecha.'

export function resumirHerramienta(tool: string, input: unknown): ResumenHerramienta {
  const a = (input ?? {}) as Record<string, unknown>
  const pedido = texto(a.order_number, 30)
  const dePedido = pedido ? ` del pedido #${pedido.replace(/^#/, '')}` : ''

  switch (tool) {
    case 'crear_pedido': {
      const items = Array.isArray(a.items) ? (a.items as Array<Record<string, unknown>>) : []
      const detalle = items
        .map((i) => `${numero(i.quantity) ?? 1}× ${texto(i.title, 40) || 'producto'}`)
        .join(', ')
      return {
        titulo: '¿Crear el pedido que armó el agente?',
        cuerpo:
          `Lo pidió la clienta por chat.\n` +
          (detalle ? `Lleva: ${detalle}.\n` : '') +
          `Si aceptas, se crea en la tienda y se le manda para pagar.`,
        comoContarlo: `Le estoy confirmando el pedido con el equipo. ${ESPERA}`,
      }
    }
    case 'crear_checkout':
      return {
        titulo: '¿Mandarle el link de compra?',
        cuerpo: 'El agente armó un carrito y quiere pasárselo a la clienta para que pague.',
        comoContarlo: `Le estoy preparando el link. ${ESPERA}`,
      }
    case 'crear_link_de_pago': {
      const items = Array.isArray(a.items) ? (a.items as Array<Record<string, unknown>>) : []
      const total = items.reduce(
        (n, i) => n + (numero(i.unit_price) ?? 0) * (numero(i.quantity) ?? 1),
        0,
      )
      return {
        titulo: `¿Cobrarle ${total > 0 ? total : 'por link'}?`,
        cuerpo:
          `El agente quiere mandarle un link de pago de Mercado Pago.\n` +
          (total > 0 ? `Total: ${total}.\n` : '') +
          `El dinero va a la cuenta del negocio.`,
        comoContarlo: `Le estoy preparando el link de pago. ${ESPERA}`,
      }
    }
    case 'ofrecer_descuento': {
      const pct = numero(a.percent)
      return {
        titulo: `¿Darle ${pct ? `${pct}%` : 'un descuento'}?`,
        cuerpo:
          `La clienta pidió un descuento y el agente quiere emitirle un cupón de un solo uso.\n` +
          (texto(a.reason) ? `Motivo: ${texto(a.reason)}\n` : '') +
          `Sale de tu margen.`,
        comoContarlo: `Estoy viendo qué puedo hacer con el precio. ${ESPERA}`,
      }
    }
    case 'registrar_pago':
      return {
        titulo: `¿Dar por pagado el pedido${dePedido ? dePedido : ''}?`,
        cuerpo:
          `La clienta dice que ya transfirió${dePedido}.\n` +
          `Si aceptas, el pedido queda cobrado y dejan de salirle los recordatorios.`,
        comoContarlo: `Estoy verificando el pago. ${ESPERA}`,
      }
    case 'editar_pedido': {
      const n = numero(a.add_units)
      return {
        titulo: `¿Sumar ${n ?? ''} unidad(es)${dePedido}?`,
        cuerpo:
          `La clienta quiere agregar${dePedido}.\n` +
          (texto(a.reason) ? `Motivo: ${texto(a.reason)}\n` : ''),
        comoContarlo: `Estoy viendo si puedo sumarlo al pedido. ${ESPERA}`,
      }
    }
    case 'abrir_devolucion':
      return {
        titulo: `¿Abrir la ${a.kind === 'cambio' ? 'solicitud de cambio' : 'devolución'}${dePedido}?`,
        cuerpo:
          `La clienta quiere ${a.kind === 'cambio' ? 'cambiar' : 'devolver'}${dePedido}.\n` +
          (texto(a.reason) ? `Motivo: ${texto(a.reason)}\n` : ''),
        comoContarlo: `Estoy registrando el caso con el equipo. ${ESPERA}`,
      }
    default:
      return {
        titulo: '¿Autorizás lo que preparó el agente?',
        cuerpo: `El agente quiere hacer "${tool}" en esta conversación.`,
        comoContarlo: `Lo pasé al equipo. ${ESPERA}`,
      }
  }
}
