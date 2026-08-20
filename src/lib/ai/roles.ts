/**
 * Quién atiende qué, cuando hay más de un agente en el mismo canal.
 *
 * El arbitraje es determinista y no pasa por un modelo. La razón es el costo
 * del error: equivocarse acá manda una consulta de "¿dónde está mi pedido?" al
 * agente de ventas, que va a contestar con catálogo. Un clasificador que acierta
 * el 95% de las veces falla una de cada veinte conversaciones, todos los días, y
 * el comercio no tiene forma de ver por qué. Estas reglas se leen, se prueban y
 * se corrigen.
 *
 * El rol NO habilita capacidades: sólo decide a quién le toca el mensaje. Lo
 * que un agente puede hacer vive en `permissions` (ver `agentCan`). Es la
 * lección de las migraciones 131/133, donde un toggle de "agente completo"
 * terminó borrándose porque lo que hacía falta era conducta, no un modo.
 */

export const AGENT_ROLES = [
  'general',
  'ventas',
  'postventa',
  'recuperacion',
  'retencion',
] as const

export type AgentRole = (typeof AGENT_ROLES)[number]

export function isAgentRole(v: unknown): v is AgentRole {
  return typeof v === 'string' && (AGENT_ROLES as readonly string[]).includes(v)
}

/** Acciones que se pueden permitir o negar por agente. */
export const AGENT_PERMISSIONS = [
  'crear_pedidos',
  'crear_checkout',
  'registrar_pago',
  'editar_pedido',
  'escalar_llamada',
  'enviar_proactivo',
] as const

export type AgentPermission = (typeof AGENT_PERMISSIONS)[number]

export type AgentPermissions = Partial<Record<AgentPermission, boolean>>

/**
 * ¿Este agente puede hacer esto?
 *
 * Con `permissions` en NULL cae a las columnas viejas, que es como se comporta
 * todo lo que ya existe: `puede_crear_pedidos` para crear pedidos, y permitido
 * para el resto (era el comportamiento anterior, gateado sólo por si había
 * Shopify conectado). Sin ese respaldo, aplicar la migración habría apagado
 * capacidades en agentes que venían funcionando.
 */
export function agentCan(
  agent: { permissions?: unknown; puede_crear_pedidos?: boolean | null },
  permission: AgentPermission,
): boolean {
  const p = agent.permissions as AgentPermissions | null | undefined
  if (p && typeof p === 'object' && permission in p) {
    return p[permission] === true
  }
  if (permission === 'crear_pedidos') return agent.puede_crear_pedidos === true
  return true
}

/**
 * Qué hace cada rol, en las palabras que lee el agente.
 *
 * El arbitraje ya mandaba la consulta al agente correcto, pero el agente no se
 * enteraba de cuál era su trabajo: el rol vivía en la base y en el router, y
 * nunca llegaba al prompt. Un agente de postventa recibía "¿dónde está mi
 * pedido?" y contestaba como cualquier otro, porque lo único que lo distinguía
 * era la persona que el comercio hubiera escrito a mano — y casi nadie la
 * escribe.
 *
 * Cada línea dice qué hace Y qué no hace. El "qué no" es la mitad que importa:
 * sin él, el de ventas igual intenta resolver una devolución y el de postventa
 * igual intenta vender.
 *
 * No se traduce (regla de la casa: los prompts de agente siguen su propio
 * `language`); el modelo entiende la instrucción en español y contesta en el
 * idioma que le corresponde.
 */
export const ROLE_BEHAVIOR: Record<AgentRole, string | null> = {
  general: null,
  ventas:
    'Tu trabajo es VENDER: resolver dudas de producto, recomendar y cerrar la compra. ' +
    'Si la consulta es sobre un pedido que la persona YA hizo (envío, seguimiento, demora, cambio, devolución), no improvises: decí que lo revisa el equipo y escalá.',
  postventa:
    'Tu trabajo es POSTVENTA: acompañar pedidos que ya existen — estado, envío, seguimiento, demoras, cambios. ' +
    'No vendas ni ofrezcas productos nuevos, y no cierres compras: si la persona quiere comprar otra cosa, decíselo al equipo en vez de armar el pedido.',
  recuperacion:
    'Tu trabajo es RECUPERAR compras que quedaron a medias: un carrito sin terminar, un pago que no pasó. ' +
    'Andá al punto —qué faltó y cómo terminarlo— sin insistir. Si la persona dice que ya no quiere, cerrá con cortesía y no vuelvas a ofrecer.',
  retencion:
    'Tu trabajo es que la persona VUELVA A COMPRAR lo que ya usó: recordar la recompra en el momento en que se le está por acabar. ' +
    'No es una consulta abierta: si pregunta por un pedido en curso o por un problema, escalá en vez de contestar de más.',
}

/**
 * A qué rol le corresponde este mensaje.
 *
 * Devuelve el rol preferido, o null cuando nada en el mensaje lo define — ahí
 * decide el orden habitual (prioridad y antigüedad) y no este archivo.
 */
export function roleForInbound(text: string, hints?: { hasOpenCart?: boolean }): AgentRole | null {
  const t = (text ?? '').toLowerCase()

  // Postventa gana sobre todo lo demás: quien pregunta por un pedido que ya
  // hizo no quiere que le vendan otra cosa.
  if (
    /\b(pedido|orden|compr[eé]|envi[oó]|env[ií]o|gu[ií]a|tracking|seguimiento|paquete|lleg[oó]|demor|retras|devoluci|cambio|reembols|garant)/.test(
      t,
    ) ||
    /#\d{3,}/.test(t)
  ) {
    return 'postventa'
  }

  // Recuperación: sólo si el contexto dice que hay algo sin terminar. Sin esa
  // señal, "no pude pagar" es una consulta de ventas cualquiera.
  if (hints?.hasOpenCart && /\b(pag|tarjeta|rechaz|carrito|checkout|link)/.test(t)) {
    return 'recuperacion'
  }

  return null
}

/**
 * El agente que atiende, entre varios candidatos del mismo canal.
 *
 * Sólo se llama cuando hay más de uno. Un comercio con un solo agente por canal
 * —o sea, todos los que existen hoy— nunca pasa por acá, así que la conducta
 * anterior queda intacta.
 */
export function pickByRole<T extends { role?: string | null }>(
  candidates: T[],
  wanted: AgentRole | null,
): T | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  if (wanted) {
    const exacto = candidates.find((c) => c.role === wanted)
    if (exacto) return exacto
  }

  // Sin rol pedido (o sin nadie que lo cubra): el de ventas atiende lo que
  // entra, y si no hay, el general. Recién después, el primero de la lista,
  // que ya viene ordenada por prioridad y antigüedad.
  return (
    candidates.find((c) => c.role === 'ventas') ??
    candidates.find((c) => c.role === 'general') ??
    candidates[0]
  )
}
