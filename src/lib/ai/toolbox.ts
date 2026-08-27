import { agentCan, type AgentPermission } from './roles'

/**
 * Todo lo que el agente puede hacer, en una sola lista, y con qué correa.
 *
 * Hasta acá cada capacidad se prendía en un lugar distinto: un booleano en
 * `permissions`, una columna vieja (`puede_crear_pedidos`), un tope numérico en
 * otra tabla, y varias directamente cableadas —cancelar y reembolsar existían
 * si el agente tenía permiso de editar pedidos, que no es lo mismo—. El
 * comercio no tenía forma de mirar una pantalla y saber qué hace su agente
 * solo y qué no.
 *
 * **Los tres estados son el producto.** Apagar y prender no alcanza: entre "no
 * lo hace" y "lo hace solo" está el caso que un negocio real quiere casi
 * siempre —que lo prepare y lo confirme una persona—, y ese es justamente el
 * lugar donde se decide cuándo entra un humano. `aprobacion` deja la propuesta
 * armada y le avisa al comercio por WhatsApp; recién con el sí se ejecuta.
 *
 * **Por qué algunas no pueden ir en `auto`.** Este agente lee texto escrito por
 * desconocidos. Cancelar un pedido y devolver dinero no se deshacen, así que
 * ahí el único par de opciones honesto es "no lo hace" o "lo prepara y alguien
 * confirma": un mensaje bien armado no puede terminar en plata que sale sola.
 * Quien no quiera la confirmación tiene la opción de apagarlas.
 */

export const TOOL_MODES = ['off', 'aprobacion', 'auto'] as const
export type ToolMode = (typeof TOOL_MODES)[number]

/** En qué se agrupan en la pantalla. */
export const TOOL_GROUPS = ['catalogo', 'venta', 'pedidos', 'postventa', 'conversacion'] as const
export type ToolGroup = (typeof TOOL_GROUPS)[number]

/** Qué tiene que existir en la cuenta para que la herramienta sirva. */
export type ToolRequirement = 'tienda' | 'shopify' | 'cobro' | 'descuento' | 'voz' | null

export interface ToolSpec {
  key: string
  group: ToolGroup
  /** Los modos que admite. Una lectura no tiene sentido "con aprobación". */
  modes: readonly ToolMode[]
  /** Lo que hace si el comercio nunca tocó nada. Es la conducta de siempre:
   *  esta pantalla vino a dar control, no a cambiarle el agente a nadie. */
  fallback: ToolMode
  /** Permiso viejo del que hereda mientras el comercio no elija. */
  legacy?: AgentPermission
  requires: ToolRequirement
  /** ¿Mueve plata o toca un pedido real? La pantalla lo marca. */
  sensible?: boolean
  /**
   * Ya pregunta por su cuenta: cancelar y reembolsar arman la solicitud como
   * parte de lo que hacen. Ponerles encima el freno genérico pediría dos
   * confirmaciones por lo mismo.
   */
  proponeSolo?: boolean
}

export const AGENT_TOOLBOX: readonly ToolSpec[] = [
  // ── Catálogo ────────────────────────────────────────────────────
  { key: 'buscar_producto', group: 'catalogo', modes: ['off', 'auto'], fallback: 'auto', requires: null },
  { key: 'ver_producto', group: 'catalogo', modes: ['off', 'auto'], fallback: 'auto', requires: null },

  // ── Venta ───────────────────────────────────────────────────────
  {
    key: 'crear_checkout',
    group: 'venta',
    modes: ['off', 'aprobacion', 'auto'],
    fallback: 'auto',
    legacy: 'crear_checkout',
    // El enlace de carrito es de Shopify. Tiendanube y WooCommerce no tienen
    // uno equivalente: ahí se manda a pagar creando el pedido, que devuelve el
    // enlace de pago de la propia tienda. Por eso `crear_pedido` es la que
    // cierra la venta en esas plataformas y no ésta.
    requires: 'shopify',
  },
  {
    key: 'crear_link_de_pago',
    group: 'venta',
    modes: ['off', 'aprobacion', 'auto'],
    fallback: 'auto',
    legacy: 'crear_checkout',
    requires: 'cobro',
  },
  {
    key: 'ofrecer_descuento',
    group: 'venta',
    modes: ['off', 'aprobacion', 'auto'],
    fallback: 'auto',
    legacy: 'crear_checkout',
    // Shopify, y no "tiene tope": el tope es una decisión del comercio que se
    // edita en la misma fila, pero el cupón lo emite Shopify. En una tienda
    // Tiendanube o WooCommerce la herramienta se ofrecía igual y fallaba al
    // ejecutarse — después de que el agente le prometiera la rebaja a la
    // clienta, que es el peor momento para no poder cumplir.
    requires: 'shopify',
    sensible: true,
  },
  {
    key: 'crear_pedido',
    group: 'venta',
    modes: ['off', 'aprobacion', 'auto'],
    fallback: 'auto',
    legacy: 'crear_pedidos',
    requires: 'tienda',
    sensible: true,
  },

  // ── Pedidos ─────────────────────────────────────────────────────
  { key: 'lookup_order', group: 'pedidos', modes: ['off', 'auto'], fallback: 'auto', requires: 'tienda' },
  {
    key: 'registrar_pago',
    group: 'pedidos',
    modes: ['off', 'aprobacion', 'auto'],
    fallback: 'auto',
    legacy: 'registrar_pago',
    requires: null,
    sensible: true,
  },
  {
    key: 'editar_pedido',
    group: 'pedidos',
    modes: ['off', 'aprobacion', 'auto'],
    fallback: 'auto',
    legacy: 'editar_pedido',
    requires: 'shopify',
    sensible: true,
  },

  // ── Postventa ───────────────────────────────────────────────────
  //
  // Sin `auto` a propósito: no se deshacen. Ver la nota de arriba.
  {
    key: 'cancelar_pedido',
    group: 'postventa',
    modes: ['off', 'aprobacion'],
    fallback: 'aprobacion',
    legacy: 'editar_pedido',
    requires: 'shopify',
    sensible: true,
    proponeSolo: true,
  },
  {
    key: 'reembolsar',
    group: 'postventa',
    modes: ['off', 'aprobacion'],
    fallback: 'aprobacion',
    legacy: 'editar_pedido',
    requires: 'shopify',
    sensible: true,
    proponeSolo: true,
  },
  {
    key: 'abrir_devolucion',
    group: 'postventa',
    modes: ['off', 'aprobacion', 'auto'],
    fallback: 'auto',
    requires: null,
  },

  // ── Conversación ────────────────────────────────────────────────
  {
    key: 'escalar_llamada',
    group: 'conversacion',
    modes: ['off', 'auto'],
    fallback: 'auto',
    legacy: 'escalar_llamada',
    requires: 'voz',
  },
  {
    key: 'enviar_proactivo',
    group: 'conversacion',
    modes: ['off', 'auto'],
    fallback: 'auto',
    legacy: 'enviar_proactivo',
    requires: null,
  },
  {
    // Buscar en internet.
    //
    // Nace APAGADA, y es la unica del tablero que nace asi: el resto describe
    // lo que el agente ya hacia. Esta le abre una fuente que el comercio no
    // escribio, asi que la enciende quien la quiera, a sabiendas. Ademas cada
    // busqueda se cobra.
    key: 'buscar_en_internet',
    group: 'conversacion',
    modes: ['off', 'auto'],
    fallback: 'off',
    requires: null,
  },
  {
    key: 'no_se_la_respuesta',
    group: 'conversacion',
    modes: ['off', 'auto'],
    fallback: 'auto',
    requires: null,
  },
  { key: 'ver_contacto', group: 'conversacion', modes: ['off', 'auto'], fallback: 'auto', requires: null },
  { key: 'etiquetar_contacto', group: 'conversacion', modes: ['off', 'auto'], fallback: 'auto', requires: null },
  { key: 'cerrar_conversacion', group: 'conversacion', modes: ['off', 'auto'], fallback: 'auto', requires: null },
] as const

export type AgentToolKey = (typeof AGENT_TOOLBOX)[number]['key']

const POR_CLAVE = new Map(AGENT_TOOLBOX.map((t) => [t.key, t]))

export function toolSpec(key: string): ToolSpec | null {
  return POR_CLAVE.get(key) ?? null
}

export function isToolMode(v: unknown): v is ToolMode {
  return typeof v === 'string' && (TOOL_MODES as readonly string[]).includes(v)
}

export type AgentTools = Record<string, ToolMode>

interface AgentLike {
  tools?: unknown
  permissions?: unknown
  puede_crear_pedidos?: boolean | null
}

/**
 * Con qué correa corre esta herramienta en este agente.
 *
 * El orden es lo que hace que aplicar esto no le cambie el agente a nadie:
 * primero lo que el comercio eligió, después el permiso viejo del que hereda,
 * y recién al final el respaldo de la herramienta. Un agente que venía
 * funcionando sigue exactamente igual hasta que alguien toque la pantalla.
 */
export function toolMode(agent: AgentLike, key: string): ToolMode {
  const spec = POR_CLAVE.get(key)
  if (!spec) return 'off'

  const elegido = (agent.tools as AgentTools | null | undefined)?.[key]
  if (isToolMode(elegido)) {
    // Un modo guardado que la herramienta ya no admite —porque la lista
    // cambió— no puede quedar mandando: cae al respaldo.
    return spec.modes.includes(elegido) ? elegido : spec.fallback
  }

  if (spec.legacy) {
    return agentCan(agent, spec.legacy) ? spec.fallback : 'off'
  }
  return spec.fallback
}

/** ¿Está prendida, en el modo que sea? */
export function toolEnabled(agent: AgentLike, key: string): boolean {
  return toolMode(agent, key) !== 'off'
}

/** ¿Tiene que pasar por una persona antes de ejecutarse? */
export function toolNeedsApproval(agent: AgentLike, key: string): boolean {
  return toolMode(agent, key) === 'aprobacion'
}

/**
 * Normaliza lo que llega del formulario: descarta claves desconocidas y modos
 * que la herramienta no admite. El cuerpo de un PATCH lo arma un cliente que no
 * controlamos, y esto termina decidiendo si sale plata sola.
 */
export function sanitizeTools(input: unknown): AgentTools | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out: AgentTools = {}
  for (const [key, valor] of Object.entries(input as Record<string, unknown>)) {
    const spec = POR_CLAVE.get(key)
    if (!spec) continue
    if (!isToolMode(valor) || !spec.modes.includes(valor)) continue
    out[key] = valor
  }
  return Object.keys(out).length > 0 ? out : null
}
