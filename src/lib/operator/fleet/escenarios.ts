/**
 * Cien cosas que un comercio puede pedirle al equipo.
 *
 * No es una lista de ejemplos bonitos: es el banco de pruebas del
 * entendimiento. Están escritos como los escribe alguien apurado —sin tildes,
 * con "porque" en vez de "por qué", en inglés a mitad de camino, con dos
 * pedidos pegados con una "y"— porque así es como llegan de verdad, y un
 * detector que sólo entiende la forma correcta falla justo con quien más
 * escribe.
 *
 * Vive fuera del `.test.ts` a propósito: es data del producto, no de una
 * prueba. Cuando el equipo aprenda a hacer algo nuevo, el escenario se agrega
 * acá y la prueba lo levanta sola.
 */
import type { SubagentId } from './types'
import type { Verbo } from './intencion'

export interface Escenario {
  /** Lo que escribe la persona. */
  texto: string
  /** Qué pide hacer. */
  verbo: Verbo
  /**
   * Qué dominios tienen que aparecer. No es la lista completa: es lo que NO se
   * puede pasar por alto. Que aparezca uno de más no rompe nada; que falte el
   * principal manda el pedido al equipo equivocado.
   */
  dominios: SubagentId[]
  /** ¿Necesita reparto, o lo contesta el orquestador solo? */
  complejo: boolean
}

export const ESCENARIOS: Escenario[] = [
  // ── Lo simple: preguntas que se contestan leyendo ─────────────────────
  { texto: '¿Cómo viene la semana?', verbo: 'consultar', dominios: [], complejo: false },
  { texto: 'como venimos este mes', verbo: 'consultar', dominios: [], complejo: false },
  { texto: 'dame un resumen de la cuenta', verbo: 'consultar', dominios: [], complejo: false },
  { texto: 'How is the week going?', verbo: 'consultar', dominios: [], complejo: false },
  { texto: '¿cuántos contactos tengo?', verbo: 'consultar', dominios: ['contactos'], complejo: false },
  { texto: 'cuantas automatizaciones tengo activas', verbo: 'consultar', dominios: ['automatizaciones'], complejo: false },
  { texto: 'mostrame las plantillas', verbo: 'consultar', dominios: ['plantillas'], complejo: false },
  { texto: 'que plantillas tengo aprobadas', verbo: 'consultar', dominios: ['plantillas'], complejo: false },
  { texto: 'listame los segmentos', verbo: 'consultar', dominios: ['contactos'], complejo: false },
  { texto: 'cuales son mis etiquetas', verbo: 'consultar', dominios: ['contactos'], complejo: false },
  { texto: 'que agentes tengo', verbo: 'consultar', dominios: ['agentes'], complejo: false },
  { texto: 'mostrame los pedidos de esta semana', verbo: 'consultar', dominios: ['pedidos'], complejo: false },
  { texto: 'cuantos pedidos entraron ayer', verbo: 'consultar', dominios: ['pedidos'], complejo: false },
  { texto: 'show me the campaigns', verbo: 'consultar', dominios: ['campanas'], complejo: false },
  { texto: 'como salio la ultima campana', verbo: 'consultar', dominios: ['campanas'], complejo: false },
  { texto: 'cuantas conversaciones estan sin responder', verbo: 'consultar', dominios: ['bandeja'], complejo: false },
  { texto: 'que hay en la bandeja', verbo: 'consultar', dominios: ['bandeja'], complejo: false },
  { texto: 'cuantos productos tengo en el catalogo', verbo: 'consultar', dominios: ['productos'], complejo: false },
  { texto: 'mostrame las llamadas de ayer', verbo: 'consultar', dominios: ['voz'], complejo: false },
  { texto: 'que comentarios quedaron sin responder', verbo: 'consultar', dominios: ['comentarios'], complejo: false },
  { texto: 'cuales son mis flujos', verbo: 'consultar', dominios: ['flujos'], complejo: false },
  { texto: 'que conexiones tengo', verbo: 'consultar', dominios: ['integraciones'], complejo: false },
  { texto: 'cual es mi zona horaria', verbo: 'consultar', dominios: ['ajustes'], complejo: false },
  { texto: 'how many contacts do I have', verbo: 'consultar', dominios: ['contactos'], complejo: false },
  { texto: 'list my templates', verbo: 'consultar', dominios: ['plantillas'], complejo: false },

  // ── Diagnóstico: algo se rompió ───────────────────────────────────────
  { texto: 'porque no le llego el mensaje a mi cliente', verbo: 'diagnosticar', dominios: ['bandeja'], complejo: false },
  { texto: '¿por qué no salió la campaña?', verbo: 'diagnosticar', dominios: ['campanas'], complejo: false },
  { texto: 'la automatizacion no funciona', verbo: 'diagnosticar', dominios: ['automatizaciones'], complejo: false },
  { texto: 'no llegan los mensajes de carrito abandonado', verbo: 'diagnosticar', dominios: ['automatizaciones'], complejo: false },
  { texto: 'que esta frenando las ventas', verbo: 'diagnosticar', dominios: [], complejo: false },
  { texto: 'se cayo whatsapp', verbo: 'diagnosticar', dominios: ['integraciones'], complejo: false },
  { texto: 'instagram se desconecto', verbo: 'diagnosticar', dominios: ['integraciones'], complejo: false },
  { texto: 'why is my campaign failing', verbo: 'diagnosticar', dominios: ['campanas'], complejo: false },
  { texto: 'la plantilla esta fallando', verbo: 'diagnosticar', dominios: ['plantillas'], complejo: false },
  { texto: 'el agente no anda', verbo: 'diagnosticar', dominios: ['agentes'], complejo: false },
  { texto: 'no salieron las llamadas de ayer', verbo: 'diagnosticar', dominios: ['voz'], complejo: false },
  { texto: 'hay un error en el flujo del menu', verbo: 'diagnosticar', dominios: ['flujos'], complejo: false },
  { texto: 'porque no se cobro este pedido', verbo: 'diagnosticar', dominios: ['pedidos'], complejo: false },
  { texto: 'revisa por que no se envio nada ayer', verbo: 'diagnosticar', dominios: [], complejo: false },
  { texto: 'el token de meta esta vencido', verbo: 'diagnosticar', dominios: ['integraciones'], complejo: false },

  // ── Crear cosas simples ───────────────────────────────────────────────
  { texto: 'crea una etiqueta que se llame vip', verbo: 'crear', dominios: ['contactos'], complejo: true },
  { texto: 'armame un segmento de los que compraron dos veces', verbo: 'crear', dominios: ['contactos'], complejo: true },
  { texto: 'necesito una plantilla de bienvenida', verbo: 'crear', dominios: ['plantillas'], complejo: true },
  { texto: 'escribime una plantilla para avisar que el pedido salio', verbo: 'crear', dominios: ['plantillas'], complejo: true },
  { texto: 'crea un agente de postventa', verbo: 'crear', dominios: ['agentes'], complejo: true },
  { texto: 'quiero un agente que responda dudas de envio', verbo: 'crear', dominios: ['agentes'], complejo: true },
  { texto: 'arma un flujo con botones de opciones', verbo: 'crear', dominios: ['flujos'], complejo: true },
  { texto: 'create a template for order confirmation', verbo: 'crear', dominios: ['plantillas'], complejo: true },
  { texto: 'crea un producto nuevo', verbo: 'crear', dominios: ['productos'], complejo: true },
  { texto: 'prepara una campana para el viernes', verbo: 'crear', dominios: ['campanas'], complejo: true },
  { texto: 'genera un link de pago', verbo: 'crear', dominios: ['pedidos'], complejo: true },
  { texto: 'armame una automatizacion de carrito abandonado', verbo: 'crear', dominios: ['automatizaciones'], complejo: true },
  { texto: 'quiero recuperar carritos abandonados', verbo: 'crear', dominios: ['automatizaciones'], complejo: true },
  { texto: 'set up abandoned cart recovery', verbo: 'crear', dominios: ['automatizaciones'], complejo: true },
  { texto: 'configura el seguimiento automatico despues de la compra', verbo: 'crear', dominios: ['automatizaciones'], complejo: true },

  // ── Editar lo que ya existe ───────────────────────────────────────────
  { texto: 'cambiale el mensaje a la automatizacion de carrito', verbo: 'editar', dominios: ['automatizaciones'], complejo: true },
  { texto: 'actualiza la plantilla de bienvenida', verbo: 'editar', dominios: ['plantillas'], complejo: true },
  { texto: 'edita el segmento de recurrentes', verbo: 'editar', dominios: ['contactos'], complejo: true },
  { texto: 'agregale un paso mas a la automatizacion', verbo: 'editar', dominios: ['automatizaciones'], complejo: true },
  { texto: 'cambiale el tono al agente de ventas', verbo: 'editar', dominios: ['agentes'], complejo: true },
  { texto: 'corrige el precio de este producto', verbo: 'editar', dominios: ['productos'], complejo: true },
  { texto: 'update the welcome template', verbo: 'editar', dominios: ['plantillas'], complejo: true },
  { texto: 'ajusta el horario del agente', verbo: 'editar', dominios: ['agentes'], complejo: true },
  { texto: 'cambia la zona horaria de la cuenta', verbo: 'editar', dominios: ['ajustes'], complejo: true },
  { texto: 'renombrar el flujo del menu principal', verbo: 'editar', dominios: ['flujos'], complejo: true },
  { texto: 'actualiza la automatizacion de carrito abandonado', verbo: 'editar', dominios: ['automatizaciones'], complejo: true },
  { texto: 'quitale el ultimo paso a la automatizacion de tracking', verbo: 'editar', dominios: ['automatizaciones'], complejo: true },

  // ── Prender y apagar ──────────────────────────────────────────────────
  { texto: 'activa la automatizacion de carrito', verbo: 'activar', dominios: ['automatizaciones'], complejo: false },
  { texto: 'prende el agente de postventa', verbo: 'activar', dominios: ['agentes'], complejo: false },
  { texto: 'lanza la campana de hoy', verbo: 'activar', dominios: ['campanas'], complejo: false },
  { texto: 'turn on the abandoned cart automation', verbo: 'activar', dominios: ['automatizaciones'], complejo: false },
  { texto: 'publica el flujo nuevo', verbo: 'activar', dominios: ['flujos'], complejo: false },
  { texto: 'pausa la automatizacion de recompras', verbo: 'pausar', dominios: ['automatizaciones'], complejo: false },
  { texto: 'apaga el agente de ventas', verbo: 'pausar', dominios: ['agentes'], complejo: false },
  { texto: 'desactiva todas las campanas', verbo: 'pausar', dominios: ['campanas'], complejo: false },
  { texto: 'freno todo por hoy', verbo: 'pausar', dominios: [], complejo: false },
  { texto: 'turn off the sales agent', verbo: 'pausar', dominios: ['agentes'], complejo: false },
  { texto: 'dejar de mandar la campana de descuentos', verbo: 'pausar', dominios: ['campanas'], complejo: false },
  { texto: 'borra el segmento viejo', verbo: 'borrar', dominios: ['contactos'], complejo: false },
  { texto: 'elimina esa plantilla', verbo: 'borrar', dominios: ['plantillas'], complejo: false },
  { texto: 'delete the old flow', verbo: 'borrar', dominios: ['flujos'], complejo: false },

  // ── Lo complejo: varios dominios en un pedido ─────────────────────────
  { texto: 'arma la recuperacion de carritos con su plantilla', verbo: 'crear', dominios: ['automatizaciones', 'plantillas'], complejo: true },
  { texto: 'crea una campana para los que compraron dos veces', verbo: 'crear', dominios: ['campanas', 'contactos'], complejo: true },
  { texto: 'necesito una plantilla y una campana para el black friday', verbo: 'crear', dominios: ['plantillas', 'campanas'], complejo: true },
  { texto: 'arma un segmento de recurrentes y mandales una campana', verbo: 'crear', dominios: ['contactos', 'campanas'], complejo: true },
  { texto: 'crea un agente de postventa y su plantilla de tracking', verbo: 'crear', dominios: ['agentes', 'plantillas'], complejo: true },
  { texto: 'etiqueta a los que compraron y armales una automatizacion de recompra', verbo: 'crear', dominios: ['contactos', 'automatizaciones'], complejo: true },
  { texto: 'quiero recuperar carritos y tambien avisar cuando sale el pedido', verbo: 'crear', dominios: ['automatizaciones'], complejo: true },
  { texto: 'configura todo para bajar la carga de postventa', verbo: 'crear', dominios: [], complejo: true },
  { texto: 'armame la operacion completa de recuperacion', verbo: 'crear', dominios: [], complejo: true },
  { texto: 'set up a segment and a campaign for repeat buyers', verbo: 'crear', dominios: ['contactos', 'campanas'], complejo: true },
  { texto: 'crea la plantilla, el segmento y la campana de fin de mes', verbo: 'crear', dominios: ['plantillas', 'contactos', 'campanas'], complejo: true },
  { texto: 'arma un flujo de menu y un agente que lo atienda', verbo: 'crear', dominios: ['flujos', 'agentes'], complejo: true },
  { texto: 'quiero llamar a los que no contestaron el mensaje', verbo: 'crear', dominios: ['voz', 'bandeja'], complejo: true },
  { texto: 'etiqueta a los de carrito abandonado y despues mandales un dm', verbo: 'crear', dominios: ['contactos', 'automatizaciones'], complejo: true },
  { texto: 'crea una campana de prospeccion para mis seguidores', verbo: 'crear', dominios: ['campanas', 'prospeccion'], complejo: true },

  // ── Torcidos: como escribe la gente de verdad ─────────────────────────
  { texto: 'automatizacion carrito abandonado', verbo: 'consultar', dominios: ['automatizaciones'], complejo: false },
  { texto: 'plantillas?', verbo: 'consultar', dominios: ['plantillas'], complejo: false },
  { texto: 'hola', verbo: 'consultar', dominios: [], complejo: false },
  { texto: 'ayuda', verbo: 'consultar', dominios: [], complejo: false },
  { texto: 'necesito vender mas', verbo: 'crear', dominios: [], complejo: true },
  { texto: 'ARMAME UNA CAMPAÑA YA', verbo: 'crear', dominios: ['campanas'], complejo: true },
  { texto: '  crea   una   etiqueta  ', verbo: 'crear', dominios: ['contactos'], complejo: true },
  { texto: 'q plantillas tengo', verbo: 'consultar', dominios: ['plantillas'], complejo: false },
  { texto: 'porque no me llego nada', verbo: 'diagnosticar', dominios: [], complejo: false },
  { texto: 'la campaña de ayer, como salio?', verbo: 'consultar', dominios: ['campanas'], complejo: false },
]
