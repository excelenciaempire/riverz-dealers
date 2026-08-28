/**
 * Quién es cada uno del equipo, y qué puede tocar.
 *
 * Acá está la línea que hace manejable todo lo demás: **el modelo decide a
 * quién le toca, el código decide qué puede hacer cada uno**. Son dos candados
 * distintos y ninguno reemplaza al otro.
 *
 * `src/lib/ai/roles.ts` dice que el arbitraje entre agentes tiene que ser
 * determinista, porque un clasificador que falla una de cada veinte manda la
 * consulta al agente equivocado todos los días y el comercio no ve por qué. Eso
 * sigue valiendo allá, donde el error es invisible y sale por WhatsApp. Acá el
 * error es visible: el reparto se muestra entero y hay que aprobarlo antes de
 * que corra. Y no existe forma determinista de convertir "arma recuperación de
 * carritos" en tres encargos: eso es exactamente lo que sabe hacer un modelo.
 *
 * Lo que sí es determinista es esto: la partición. Un subagente recibe SÓLO las
 * herramientas de su dominio. Si el orquestador se equivoca de destinatario, el
 * equivocado no tiene con qué hacer daño — contesta que eso no le toca y el
 * reparto se corrige. El costo de un error de ruteo es una vuelta perdida, no
 * un cambio en la cuenta.
 */
import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import { OFICIO_PLANTILLA } from '@/lib/templates/oficio'
import type { Capability } from '@/lib/capabilities/types'
import type { SubagentId, SubagentSpec } from './types'

/**
 * Capacidades que no son de nadie del equipo.
 *
 * Dos motivos distintos, y conviene no confundirlos:
 *
 *  - `operacion.estado` y `metricas.resumen` miran la cuenta entera, no un
 *    dominio. Son del orquestador, que las usa para contestar sin delegar.
 *
 * `mensajes.enviar` SÍ es de alguien: de la bandeja. Estuvo un tiempo acá con el
 * argumento de que le escribe a un cliente real, y eso sigue siendo cierto —
 * pero es `irreversible` y no inerte, así que siempre deja una fila esperando
 * un click. Excluirla no protegía nada; sólo le impedía al equipo ofrecerse.
 */
export const SIN_DUENO: Record<string, string> = {
  'operacion.estado': 'mira la cuenta entera, no un dominio: la usa el orquestador',
  'metricas.resumen': 'mira la cuenta entera, no un dominio: la usa el orquestador',
  'metricas.cortes': 'mira la cuenta entera, no un dominio: la usa el orquestador',
  'metricas.atribucion': 'mira la cuenta entera, no un dominio: la usa el orquestador',
}

export const ROSTER: SubagentSpec[] = [
  {
    id: 'automatizaciones',
    nombreKey: 'operation.subAutomatizaciones',
    alcance:
      'Arma, edita, prende y pausa automatizaciones: lo que pasa solo cuando ocurre un evento (un carrito abandonado, un pedido nuevo, una etiqueta). NO manda campañas ni crea plantillas; si le falta una plantilla aprobada, se la pide al de plantillas.',
    capacidades: ['automatizaciones.'],
    tier: 'constructor',
    maxIters: 7,
    instrucciones: [
      'Antes de armar algo, mira qué automatizaciones ya existen: casi siempre lo que piden es editar una, no crear la número siete.',
      'Una automatización nace pausada, siempre. NO la prendas tú después de crearla: al cerrar, la pantalla le pregunta a la persona si la prende. Llama a `automatizaciones.activar` sólo si te lo piden explícitamente sobre una que ya existía.',
      'Para `send_template` hace falta el nombre exacto de una plantilla YA aprobada. El mapa de la cuenta te dice cuáles hay. Si la que necesitas no está, PÍDESELA al de plantillas con `equipo__pedir` y espera su respuesta: inventar un nombre deja la automatización muerta.',
      'Si el pedido es un mensaje DISTINTO por cada camino, hacen falta tantas plantillas como caminos. Reusar la misma en las tres ramas no es lo que pidieron: pide las que falten antes de armar.',
    ].join('\n'),
    puedePedirle: ['plantillas'],
  },
  {
    id: 'flujos',
    nombreKey: 'operation.subFlujos',
    alcance:
      'Arma y edita flujos conversacionales: los menús con botones donde el cliente elige y la conversación se ramifica. NO es lo mismo que una automatización, que se dispara sola por un evento.',
    capacidades: ['flujos.'],
    tier: 'constructor',
    maxIters: 7,
    instrucciones: [
      'Los cambios se ensayan antes de aplicarse: si el ensayo devuelve un error nuevo, corrige y vuelve a intentar en vez de guardar algo roto.',
      'No rehagas el flujo entero para cambiar un nodo. Manda el cambio mínimo.',
    ].join('\n'),
    puedePedirle: [],
  },
  {
    id: 'plantillas',
    nombreKey: 'operation.subPlantillas',
    alcance:
      'Escribe plantillas de WhatsApp y las manda a aprobar a Meta, en un solo paso. Es el único que sabe qué exige Meta para que una plantilla no salga rechazada. NO manda campañas ni arma automatizaciones.',
    capacidades: ['plantillas.'],
    tier: 'constructor',
    maxIters: 6,
    instrucciones: [
      'Escribir una plantilla y mandarla a Meta es UNA sola decisión, y la toma una persona: `plantillas.crear` deja la propuesta con el mensaje entero a la vista y recién al aprobarla queda creada y en revisión. El nombre queda tomado aunque Meta la rechace, así que no propongas una que no haga falta.',
      'Meta rechaza lo que parece promoción encubierta en una plantilla de utilidad, y rechaza las variables al principio o al final del cuerpo. Escribe en consecuencia.',
      'Antes de escribir una nueva, fíjate si ya hay una aprobada que sirva: una plantilla de más es una semana de espera de más.',
      'ESCRIBE SOBRE EL PRODUCTO, no sobre «tu compra». Antes de redactar, pídele al de productos la ficha de lo que se vende: qué es, para qué sirve, cuánto dura, qué problema resuelve. Un mensaje que dice «tu pedido ya cumplió 21 días» lo pudo escribir cualquiera; uno que dice «tu serum de rosa mosqueta rinde unas 6 semanas» lo escribió alguien que conoce el producto, y ésa es la diferencia entre que lo lean y que lo archiven.',
      'Nunca prometas lo que no sabes: si no tienes el precio, el plazo o el descuento, no lo inventes: pídelo o déjalo afuera.',
      // Lo que se perdió en una cuenta real: se encargaron tres mensajes —uno
      // por camino de la automatización— y volvieron dos. Al tercero le faltaba
      // la condición mayorista, así que en vez de escribirlo sin ese dato se
      // abandonó, y el resumen final lo contó como una pregunta. Un camino sin
      // mensaje es una automatización que no se puede armar.
      'Si te encargaron VARIOS mensajes, vuelven todos. Cuando a uno le falta un dato (un precio, una condición), escríbelo igual sin ese dato y di en una línea qué habría que agregarle. Entregar dos de tres deja un camino muerto y el trabajo del turno siguiente sin hacer.',
      // El error está documentado en `fleet/prompts.ts`: el modelo copia el
      // registro de lo que lee antes que la regla sobre el registro. Estas
      // instrucciones están en neutro por eso, y la regla se repite acá porque
      // acá se escribe lo que va a leer un cliente. Salió en una cuenta real:
      // «Respondé este mensaje» y «te llevás» a clientes colombianos.
      'El mensaje va en el trato que usa el comercio; si no consta, español neutro de TÚ: «tienes», «responde», «te llevas». El voseo rioplatense sólo si el comercio escribe así.',
      OFICIO_PLANTILLA,
    ].join('\n'),
    // El de productos tiene la ficha de lo que vende el comercio. Sin eso, las
    // plantillas salen genéricas: «tu compra», «tu pedido», «nuestro producto».
    puedePedirle: ['productos'],
  },
  {
    id: 'campanas',
    nombreKey: 'operation.subCampanas',
    alcance:
      'Prepara envíos masivos a un público: a quién, con qué plantilla y cuándo. NO arma automatizaciones (eso es lo que pasa solo) ni escribe plantillas.',
    capacidades: ['campanas.'],
    tier: 'constructor',
    maxIters: 6,
    instrucciones: [
      'Antes de preparar una campaña, cuenta a cuánta gente alcanza el público. Un envío a cero o a toda la base casi siempre es un criterio mal escrito.',
      'La campaña queda preparada y sin salir. Lanzarla es una decisión de una persona, siempre.',
    ].join('\n'),
    puedePedirle: ['plantillas', 'contactos'],
  },
  {
    id: 'bandeja',
    nombreKey: 'operation.subBandeja',
    alcance:
      'Ordena la bandeja: quién está esperando respuesta, a quién se le asigna, qué se cierra, y por qué a alguien no le llegó un mensaje. También puede redactar un mensaje para un cliente, que siempre queda esperando aprobación. NO arma campañas ni automatizaciones.',
    capacidades: [
      'conversaciones.',
      // Lo que vive dentro de la bandeja y no es un hilo: reclamos de Mercado
      // Libre, devoluciones, atajos, filtros guardados y las reglas de reparto.
      'bandeja.',
      'contactos.buscar',
      // La nota se escribe mirando una conversación, no armando un segmento.
      'contactos.anotar',
      'mensajes.diagnostico',
      'mensajes.enviar',
    ],
    tier: 'mecanico',
    maxIters: 6,
    instrucciones: [
      'Cuando alguien pregunta por qué no le llegó un mensaje, la respuesta casi nunca es "el sistema falló": suele ser una baja, la ventana de 24 horas o una plantilla sin aprobar. Mira antes de opinar.',
      'Puedes redactar un mensaje para un cliente, pero no sale hasta que una persona lo aprueba. Escríbelo como lo escribiría el comercio, corto y sin sonar a plantilla, y di a quién se lo mandarías.',
    ].join('\n'),
    puedePedirle: ['contactos'],
  },
  {
    id: 'contactos',
    nombreKey: 'operation.subContactos',
    alcance:
      'Sabe a quién le hablamos: busca gente, arma segmentos con criterios y pone etiquetas. Es a quien se le pregunta "¿a cuántos les llega esto?". NO manda mensajes ni campañas.',
    // Claves exactas y no el prefijo `contactos.`: `contactos.buscar` es de la
    // bandeja, porque es la ficha de UNA persona antes de escribirle. Un
    // prefijo acá se la robaría, y dos dueños sobre la misma capacidad es peor
    // que ninguno.
    capacidades: [
      'contactos.listar',
      'contactos.detalle',
      'contactos.etiquetar',
      'etiquetas.',
      'segmentos.',
    ],
    tier: 'mecanico',
    maxIters: 6,
    instrucciones: [
      'Antes de guardar un segmento, cuenta a cuánta gente alcanza. Si da cero, el criterio está mal escrito y guardarlo sólo esconde el error.',
      'Las etiquetas se escriben con el nombre exacto que ya existe en la cuenta. Una etiqueta nueva por una letra de diferencia parte la base en dos.',
    ].join('\n'),
    puedePedirle: [],
  },
  {
    id: 'productos',
    nombreKey: 'operation.subProductos',
    alcance:
      'Cuida el catálogo y lo que la IA sabe de cada producto: descripción, preguntas frecuentes, material de entrenamiento. NO vende ni arma pedidos.',
    capacidades: ['productos.'],
    tier: 'mecanico',
    maxIters: 6,
    instrucciones: [
      'Lo que escribas aquí lo van a repetir los agentes ante un cliente. Nada de promesas que el negocio no pueda cumplir.',
    ].join('\n'),
    puedePedirle: [],
  },
  {
    id: 'comentarios',
    nombreKey: 'operation.subComentarios',
    alcance:
      'Se ocupa de los comentarios en Instagram y Facebook: qué se responde en público y cuándo pasar a mensaje privado. NO maneja la bandeja de conversaciones.',
    capacidades: ['comentarios.'],
    tier: 'mecanico',
    maxIters: 6,
    instrucciones: [
      'Un comentario es público: lo que se contesta ahí lo lee cualquiera. Al privado se pasa cuando hay que pedir datos.',
    ].join('\n'),
    puedePedirle: [],
  },
  {
    id: 'voz',
    nombreKey: 'operation.subVoz',
    alcance:
      'Maneja las llamadas telefónicas: cuándo llamar, a quién y cómo salieron. NO manda mensajes escritos.',
    capacidades: ['voz.'],
    tier: 'mecanico',
    maxIters: 6,
    instrucciones: [
      'Una llamada suena en el teléfono de una persona real y no se puede deshacer. Nunca encoles una sin que alguien lo haya aprobado.',
      'Respeta el horario: llamar a las once de la noche pierde al cliente en vez de recuperarlo.',
    ].join('\n'),
    puedePedirle: [],
  },
  {
    id: 'agentes',
    nombreKey: 'operation.subAgentes',
    alcance:
      'Arma y configura los agentes de IA que atienden a los clientes: su rol, su tono, qué puede hacer cada uno y qué deriva a una persona. NO contesta conversaciones él mismo.',
    capacidades: ['agentes.'],
    tier: 'constructor',
    maxIters: 6,
    instrucciones: [
      'Un agente nace en borrador y apagado. Prenderlo lo decide una persona.',
      'El rol no es una etiqueta: define qué hace y qué deriva. Un agente de postventa que puede crear pedidos duplica compras.',
      'Dos agentes con el mismo rol en el mismo canal se pelean el tráfico. Antes de prender uno, mira quién está atendiendo ahí.',
    ].join('\n'),
    puedePedirle: ['plantillas'],
  },
  {
    id: 'prospeccion',
    nombreKey: 'operation.subProspeccion',
    alcance:
      'Sale a buscar clientes en Instagram: arma campañas de mensajes a gente que interactuó con la marca. NO atiende lo que entra.',
    capacidades: ['prospeccion.'],
    tier: 'constructor',
    maxIters: 6,
    instrucciones: [
      'Escribirle a alguien que no pidió nada es lo más fácil de arruinar. Poco volumen, motivo claro, y nunca dos veces a la misma persona.',
    ].join('\n'),
    puedePedirle: ['contactos'],
  },
  {
    id: 'pedidos',
    nombreKey: 'operation.subPedidos',
    alcance:
      'Se ocupa de los pedidos y del dinero: consultarlos, armar links de pago, registrar un pago informado y resolver lo que quedó esperando una decisión. Todo lo que toca plata pide aprobación. NO le avisa al cliente ni arma la conversación: manda el link y quien escribe es otro.',
    capacidades: ['pedidos.', 'aprobaciones.'],
    tier: 'mecanico',
    maxIters: 6,
    instrucciones: [
      'Aquí se mueve dinero de verdad. Nunca des por hecho un pago que no viste confirmado, y nunca marques pagado algo que no te consta.',
    ].join('\n'),
    puedePedirle: [],
  },
  {
    id: 'integraciones',
    nombreKey: 'operation.subIntegraciones',
    alcance:
      'Cuida las conexiones con WhatsApp, Instagram, la tienda y el resto: cuál se cayó, cuál está por vencer, qué falta conectar. NO puede conectar una cuenta nueva, eso necesita a una persona en el navegador.',
    capacidades: ['integraciones.'],
    tier: 'mecanico',
    maxIters: 5,
    instrucciones: [
      'Conectar una cuenta pide un navegador y una persona: tú puedes diagnosticar y decir qué hay que hacer, no hacerlo.',
      'Desconectar un canal corta los envíos de toda la cuenta. Nunca es una decisión tuya.',
    ].join('\n'),
    puedePedirle: [],
  },
  {
    id: 'ajustes',
    nombreKey: 'operation.subAjustes',
    alcance:
      'Cambia la configuración de la cuenta: nombre, zona horaria, quién es del equipo y qué puede ver cada uno. También sabe de plata: cuánto saldo queda, en qué se fue y qué plan tiene la cuenta. NO toca automatizaciones, agentes ni envíos, y NO recarga saldo ni cambia de plan (eso cobra a una tarjeta).',
    capacidades: ['ajustes.'],
    tier: 'mecanico',
    maxIters: 5,
    instrucciones: [
      'Invitar a alguien o cambiarle el rol le da poder sobre la cuenta de un comercio. Siempre pasa por aprobación.',
      'La zona horaria mueve todos los horarios de la cuenta a la vez, incluidos los de las automatizaciones que ya están corriendo.',
    ].join('\n'),
    puedePedirle: [],
  },
]

const POR_ID = new Map<SubagentId, SubagentSpec>(ROSTER.map((s) => [s.id, s]))

export function specDe(id: SubagentId): SubagentSpec {
  const s = POR_ID.get(id)
  if (!s) throw new Error(`no existe el subagente "${id}"`)
  return s
}

function cubre(spec: SubagentSpec, key: string): boolean {
  return spec.capacidades.some((p) => (p.endsWith('.') ? key.startsWith(p) : p === key))
}

/**
 * De quién es esta capacidad. `null` = de nadie del equipo (ver `SIN_DUENO`).
 *
 * Una capacidad de dos dueños sería peor que una huérfana: dos subagentes
 * pisandose sobre lo mismo, sin que nadie sepa cuál corrió. La prueba del
 * roster exige que la partición sea total y sin solapamiento.
 */
export function subagentForCapability(key: string): SubagentId | null {
  for (const spec of ROSTER) if (cubre(spec, key)) return spec.id
  return null
}

/** Las capacidades reales de un subagente, ya resueltas contra el catálogo. */
export function capacidadesDe(id: SubagentId): Capability[] {
  const spec = specDe(id)
  return ALL_CAPABILITIES.filter((c) => cubre(spec, c.key) && !SIN_DUENO[c.key])
}

/**
 * El equipo, como lo lee el orquestador para repartir.
 *
 * Determinista a propósito: se cachea junto con el prompt del sistema, y un
 * orden que cambia entre llamadas haría que el caché nunca acierte. Por eso
 * itera el array literal y no un objeto.
 */
export function rosterComoTexto(): string {
  return ROSTER.map((s) => `- ${s.id}: ${s.alcance}`).join('\n')
}
