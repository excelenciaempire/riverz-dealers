/**
 * Qué quiere la persona, leído antes de gastar una llamada al modelo.
 *
 * Esto NO decide el reparto. El reparto lo hace el orquestador, porque partir
 * "armá recuperación de carritos" en tres encargos claros es trabajo de
 * lenguaje y ninguna tabla de palabras lo hace bien. Lo que sí resuelve una
 * tabla, y bien, es lo grueso: de qué está hablando y si pide mirar o pide
 * construir.
 *
 * Sirve para tres cosas concretas:
 *
 *  1. **Ahorrar el reparto cuando no hace falta.** "¿Cómo viene la semana?" no
 *     necesita equipo: el orquestador tiene las lecturas a mano y contesta él.
 *     Sin esta señal, un turno simple puede terminar delegando y tardando
 *     quince segundos en vez de cuatro.
 *  2. **Darle una pista al orquestador**, que va en el prompt como pista y no
 *     como orden. Si el modelo ve otra cosa, manda el modelo.
 *  3. **Poder probar el entendimiento sin llamar a la API.** Cien escenarios
 *     contra una función pura son gratis y dan el mismo resultado siempre.
 *
 * La bilingüe no es opcional: los comercios escriben en español y en inglés, y
 * un detector que sólo entiende español manda a la mitad de la base por el
 * camino lento.
 */
import { SUBAGENT_IDS, type SubagentId } from './types'

export type Verbo =
  | 'consultar'
  | 'diagnosticar'
  | 'crear'
  | 'editar'
  | 'activar'
  | 'pausar'
  | 'borrar'

export interface Intencion {
  verbo: Verbo
  /** De qué habla, en orden de aparición en el texto. */
  dominios: SubagentId[]
  /**
   * ¿Hace falta repartir?
   *
   * Falso significa "el orquestador puede contestar esto solo". No significa
   * "es fácil": una lectura sobre una cuenta enorme puede ser lenta y sigue
   * siendo cosa de uno.
   */
  complejo: boolean
  /** Con `baja`, la pista no se le muestra al modelo: sería ruido. */
  confianza: 'alta' | 'media' | 'baja'
}

/**
 * De qué habla.
 *
 * Frases largas antes que palabras sueltas: "carrito abandonado" tiene que
 * ganarle a "carrito", que por sí solo también aparece en una consulta de
 * pedidos. Dentro de cada dominio el orden no importa; entre dominios, sí, y
 * por eso la lista es un array y no un objeto.
 */
const DOMINIOS: Array<{ id: SubagentId; señales: string[] }> = [
  {
    id: 'automatizaciones',
    señales: [
      'carrito abandonado',
      'carritos abandonados',
      'recuperacion de carrito',
      'recuperar carrito',
      'recuperar carritos',
      'abandoned cart',
      'cart recovery',
      'automatizacion',
      'automatizaciones',
      'automatizar',
      'automation',
      'automations',
      'automatico cuando',
      'cuando alguien',
      'cada vez que',
      'disparador',
      'trigger',
      'seguimiento automatico',
      'recordatorio automatico',
      'post venta automatico',
    ],
  },
  {
    id: 'plantillas',
    señales: [
      'plantilla',
      'plantillas',
      'template',
      'templates',
      'aprobar en meta',
      'aprobada por meta',
      'mandar a meta',
      'hsm',
    ],
  },
  {
    id: 'campanas',
    señales: [
      'campana',
      'campanas',
      'campaign',
      'campaigns',
      'broadcast',
      'difusion',
      'envio masivo',
      'envios masivos',
      'mandar a todos',
      'mensaje masivo',
      'blast',
    ],
  },
  {
    id: 'flujos',
    señales: [
      'flujo',
      'flujos',
      'flow',
      'flows',
      'menu',
      'menus',
      'botones',
      'arbol de opciones',
      'opciones al cliente',
    ],
  },
  {
    id: 'contactos',
    señales: [
      'segmento',
      'segmentos',
      'segment',
      'etiqueta',
      'etiquetas',
      'etiquetar',
      'tag',
      'tags',
      'contacto',
      'contactos',
      'contact',
      'contacts',
      'publico',
      'audiencia',
      'audience',
      'base de datos',
      'mi base',
      'clientes que compraron',
      'que compraron',
      'compraron',
      'recurrentes',
    ],
  },
  {
    id: 'bandeja',
    señales: [
      'bandeja',
      'inbox',
      'conversacion',
      'conversaciones',
      'sin responder',
      'sin contestar',
      'no contestaron',
      'no contesto',
      'no le llego',
      'no les llego',
      'no llego el mensaje',
      'asignar',
      'cerrar el chat',
      'cerrar conversacion',
      'unread',
      'pendientes de respuesta',
    ],
  },
  {
    id: 'agentes',
    señales: [
      'agente',
      'agentes',
      'asistente',
      'assistant',
      'bot',
      'la ia que responde',
      'que responda sola',
      'responder solo',
      'ai agent',
      'agent',
      'agents',
    ],
  },
  {
    id: 'pedidos',
    señales: [
      'pedido',
      'pedidos',
      'orden',
      'ordenes',
      'order',
      'orders',
      'cobro',
      'cobrar',
      'pago',
      'pagos',
      'payment',
      'checkout',
      'link de pago',
      'factura',
      'reembolso',
      'refund',
    ],
  },
  {
    id: 'productos',
    señales: [
      'producto',
      'productos',
      'product',
      'products',
      'catalogo',
      'catalog',
      'precio',
      'precios',
      'stock',
      'sku',
    ],
  },
  {
    id: 'comentarios',
    señales: [
      'comentario',
      'comentarios',
      'comment',
      'comments',
      'publicacion',
      'post de instagram',
      'reel',
      'responder en publico',
    ],
  },
  {
    id: 'voz',
    señales: [
      'llamada',
      'llamadas',
      'llamar',
      'telefono',
      'por voz',
      'voice',
      'call',
      'calls',
    ],
  },
  {
    id: 'prospeccion',
    señales: [
      'prospeccion',
      'prospectar',
      'seguidores',
      'followers',
      'gente nueva',
      'clientes nuevos de instagram',
      'dm masivo',
      'outreach',
      'salir a buscar',
    ],
  },
  {
    id: 'integraciones',
    señales: [
      'conectar',
      'conexion',
      'conexiones',
      'integracion',
      'integraciones',
      'integration',
      'se desconecto',
      'se cayo',
      'token vencido',
      'token',
      'volver a conectar',
      'reconectar',
      'desconectar',
    ],
  },
  {
    id: 'ajustes',
    señales: [
      'ajustes',
      'configuracion de la cuenta',
      'zona horaria',
      'timezone',
      'invitar',
      'miembro del equipo',
      'mi equipo',
      'permisos del equipo',
      'settings',
      'renombrar la cuenta',
    ],
  },
]

/**
 * Qué pide hacer.
 *
 * El orden es el de la decisión, no el alfabético. `diagnosticar` va primero
 * porque "por qué no le llegó el mensaje" también contiene "mensaje" y "llegó",
 * y clasificarlo como consulta manda a alguien a mirar métricas cuando lo que
 * hay es algo roto. `borrar` y `pausar` van antes que `editar` por lo mismo:
 * "cambiar el estado a pausada" es pausar, no editar.
 */
const VERBOS: Array<{ verbo: Verbo; señales: string[] }> = [
  {
    verbo: 'diagnosticar',
    señales: [
      'por que no',
      'porque no',
      'why is',
      "why isn't",
      'why not',
      'no funciona',
      'no anda',
      'no llego',
      'no llegan',
      'no salio',
      'no salieron',
      'no sale',
      'esta fallando',
      'falla',
      'fallando',
      'error',
      'roto',
      'se rompio',
      'se cayo',
      'se desconecto',
      'vencido',
      'vencida',
      'not working',
      'failing',
      'que esta frenando',
      'que esta pasando con',
      'revisa por que',
    ],
  },
  {
    verbo: 'borrar',
    señales: ['borrar', 'borra ', 'eliminar', 'elimina ', 'delete', 'remove', 'sacar la'],
  },
  {
    verbo: 'pausar',
    señales: [
      'pausar',
      'pausa ',
      'pausad',
      'freno ',
      'frena ',
      'apagar',
      'apaga ',
      'desactivar',
      'desactiva ',
      'detener',
      'frenar',
      'parar ',
      'turn off',
      'pause',
      'stop',
      'dejar de',
    ],
  },
  {
    verbo: 'activar',
    señales: [
      'activar',
      'activa ',
      'prender',
      'prende ',
      'encender',
      'lanzar',
      'lanza ',
      'publicar',
      'publica ',
      'poner a andar',
      'ponelo a andar',
      'turn on',
      'activate',
      'launch',
      'enable',
    ],
  },
  {
    // Va antes que crear y editar a proposito: 'quiero ver las plantillas'
    // empieza igual que 'quiero una plantilla' y no es lo mismo.
    verbo: 'consultar',
    señales: [
      'quiero ver',
      'quiero saber',
      'necesito ver',
      'necesito saber',
      'me gustaria ver',
      'quiero entender',
    ],
  },
  {
    verbo: 'editar',
    señales: [
      'editar',
      'edita ',
      'cambiar',
      'cambia ',
      'cambiale',
      'modificar',
      'modifica ',
      'actualizar',
      'actualiza ',
      'ajustar',
      'ajusta ',
      'corregir',
      'corrige ',
      'arreglar',
      'arregla ',
      'update',
      'change',
      'edit',
      'agregale',
      'agrega un paso',
      'sumale',
      'quitale',
      'renombrar',
    ],
  },
  {
    verbo: 'crear',
    señales: [
      'crear',
      'crea ',
      'creame',
      'armar',
      'arma ',
      'armame',
      'hacer una',
      'hace una',
      'haceme',
      'hazme',
      'nueva',
      'nuevo',
      'generar',
      'genera ',
      'configurar',
      'configura ',
      'necesito una',
      'necesito un ',
      'necesito ',
      'quiero una',
      'quiero un ',
      'quiero que',
      'quiero ',
      'armal',
      'mandale',
      'mandales',
      'etiqueta a',
      'etiquetalos',
      'set up',
      'setup',
      'create',
      'build',
      'make a',
      'i want',
      'preparar',
      'prepara ',
      'escribir una',
      'escribime',
    ],
  },
  {
    verbo: 'consultar',
    señales: [
      'como viene',
      'como va',
      'como estan',
      'cuanto',
      'cuantos',
      'cuantas',
      'que tengo',
      'cuales',
      'cual es',
      'mostrame',
      'muestrame',
      'muestra ',
      'dame',
      'listame',
      'lista ',
      'ver ',
      'reporte',
      'resumen',
      'how many',
      'how is',
      'show me',
      'list ',
      'what',
    ],
  },
]

/**
 * Saca tildes, signos y mayúsculas.
 *
 * Nadie escribe "automatización" con tilde cuando está apurado, y media base
 * escribe sin acentos siempre. Un detector que distingue "campaña" de "campana"
 * falla justo con quien escribe rápido, que es todo el mundo.
 */
export function normalizar(texto: string): string {
  return ` ${texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `
}

export function leerIntencion(texto: string): Intencion {
  const t = normalizar(texto)

  // Dominios, en el orden en que aparecen en la frase: si alguien dice
  // "la plantilla del carrito abandonado", el tema es la plantilla.
  const encontrados: Array<{ id: SubagentId; en: number }> = []
  for (const d of DOMINIOS) {
    let mejor = -1
    for (const s of d.señales) {
      const i = t.indexOf(s)
      if (i >= 0 && (mejor === -1 || i < mejor)) mejor = i
    }
    if (mejor >= 0) encontrados.push({ id: d.id, en: mejor })
  }
  encontrados.sort((a, b) => a.en - b.en)
  const dominios = encontrados.map((e) => e.id)

  let verbo: Verbo = 'consultar'
  let vistoVerbo = false
  for (const v of VERBOS) {
    if (v.señales.some((s) => t.includes(s))) {
      verbo = v.verbo
      vistoVerbo = true
      break
    }
  }

  /**
   * Sólo construir pide reparto, y siempre.
   *
   * La primera versión de esta regla también marcaba complejo cualquier frase
   * que tocara dos dominios, y los escenarios mostraron que estaba mal: "qué
   * comentarios quedaron sin responder" toca comentarios y bandeja y sigue
   * siendo una sola lectura. Repartirla costaría quince segundos en vez de
   * cuatro para contestar lo mismo.
   *
   * Y al revés: construir UNA cosa tampoco es un solo paso. Armar una
   * automatización es mirar qué hay, armarla y revisar que quede activable, así
   * que merece plan aunque sea de un dominio.
   *
   * Prender, pausar y borrar quedan afuera: son una llamada y ya.
   */
  const complejo = verbo === 'crear' || verbo === 'editar'

  const confianza: Intencion['confianza'] =
    dominios.length > 0 && vistoVerbo
      ? 'alta'
      : dominios.length > 0 || vistoVerbo
        ? 'media'
        : 'baja'

  return { verbo, dominios, complejo, confianza }
}

/**
 * La pista, como la lee el orquestador.
 *
 * Vacía cuando la confianza es baja: media pista es peor que ninguna, porque el
 * modelo la toma en serio igual. Y siempre dice que es una pista: sin eso, un
 * detector que se equivoca arrastra al orquestador al dominio equivocado.
 */
export function pistaComoTexto(i: Intencion): string {
  if (i.confianza === 'baja') return ''
  const partes: string[] = []
  if (i.dominios.length > 0) partes.push(`parece de: ${i.dominios.join(', ')}`)
  partes.push(`parece que pide: ${i.verbo}`)
  if (i.complejo) partes.push('probablemente necesite reparto')
  return `PISTA (es una lectura de palabras, no una orden; si ves otra cosa, mandás vos): ${partes.join(' · ')}.`
}

/** Para las pruebas: que ningún dominio del roster quede sin señales. */
export function dominiosConSeñales(): SubagentId[] {
  return DOMINIOS.map((d) => d.id)
}

export const TODOS_LOS_DOMINIOS = SUBAGENT_IDS
