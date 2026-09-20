import type { ShopifyOrder } from './shopify';

/**
 * Las dos reglas del lado flojo de la atribución, fuera de la ruta.
 *
 * Viven acá y no dentro de `/api/analytics/attribution` porque son las que
 * deciden cuánta plata se le cuelga a cada campaña, y una ruta de Next no se
 * puede probar sin levantar media aplicación. Separadas se prueban en un
 * milisegundo y se rompen fuerte cuando alguien las toca.
 */

/** Qué clase de cosa tocó el pedido. La UI la traduce; acá viaja el código. */
export type SourceKind = 'automation' | 'broadcast' | 'flow' | 'agent';

/** Un mensaje de Riverz que le llegó a alguien antes de que comprara. */
export interface Toque {
  kind: SourceKind;
  /** La campaña, el flujo, la automatización o el agente concreto. */
  entityId: string;
  name: string;
  at: string;
}

/**
 * El último toque de CADA lente dentro de la ventana del pedido.
 *
 * Una lente aporta como mucho un toque: si a la persona le llegaron tres
 * campañas, la que explica la compra es la última. Que dos lentes distintas
 * aporten cada una la suya es lo esperado y no duplica el pedido —eso lo
 * resuelve `evidence`, que cuenta el pedido y no las lentes.
 *
 * `toques` tiene que venir ordenado del más nuevo al más viejo.
 */
export function ultimoToquePorLente(
  toques: Toque[],
  orderTime: number,
  lookbackMs: number
): Toque[] {
  const desde = orderTime - lookbackMs;
  const salida: Toque[] = [];
  const vistas = new Set<SourceKind>();
  for (const t of toques) {
    const at = Date.parse(t.at);
    if (at > orderTime || at < desde) continue;
    if (vistas.has(t.kind)) continue;
    vistas.add(t.kind);
    salida.push(t);
  }
  return salida;
}

/** Only paid, non-cancelled orders. Refunds require net-receipt data before counting. */
export function esVentaReal(order: ShopifyOrder): boolean {
  // Unknown, pending, authorized and partially-paid orders are not paid sales.
  // Refunded orders are excluded until net receipts can be measured reliably.
  return !order.cancelled_at && order.financial_status === 'paid';
}
