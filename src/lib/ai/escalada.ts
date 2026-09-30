/**
 * CUÁNDO ESTO NECESITA UNA PERSONA.
 *
 * Hasta acá se escalaba por tres cosas: una palabra de una lista, un número de
 * mensajes, y que el agente admitiera no saber. Las tres se pierden lo que más
 * urge, que es un problema REAL en curso.
 *
 * El caso que lo dejó claro (2026-08-28, conversación con Rosanna): el agente
 * le pasó el seguimiento del envío, ella mandó la captura de Andreani y
 * escribió "está en camino al bolsón" y "yo vivo en Puerto Madryn". El paquete
 * viajaba a Carlos Casares, a 1.400 km de su casa. No hay palabra de escalada,
 * no hay diez mensajes, el agente no dijo "no sé": el agente iba a seguir
 * conversando mientras el envío se alejaba. Eso lo tiene que ver una persona
 * en minutos, no mañana.
 *
 * Por eso acá hay DOS capas y no una:
 *
 *   1. Señales duras, por texto. Son gratis, instantáneas y no fallan cuando
 *      el modelo está caído o sin saldo. Cubren lo que se dice con palabras
 *      que se repiten: pedir una persona, amenazar con un abogado, decir que
 *      no llegó, denunciar un cobro doble.
 *   2. El clasificador, sólo si las señales no dijeron nada Y la conversación
 *      muestra fricción. Es el que caza lo de Rosanna, que no tiene ninguna
 *      palabra de la lista y aun así es urgente. Desde el 2026-09-19 decide
 *      Jev (`jev.ts`): preguntas cerradas con probabilidad, ~300 ms y veinte
 *      veces más barato que Haiku, que queda de respaldo cuando no hay llave.
 *
 * Lo que NO se escala: una pregunta difícil. Para eso está el agente. Escalar
 * de más entrena al comercio a ignorar los avisos, que es la única forma de
 * que un aviso deje de servir.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hayJev, preguntarJev, type RespuestasDe } from './jev';
import { completeTextMedido } from './medido';
import { recoveryButtonKind } from './recovery-policy';

/** Qué tan rápido hay que meterse. Define el tono del aviso, no si sale. */
export type Urgencia = 'ahora' | 'hoy';

export interface Escalada {
  /** Etiqueta corta y estable, para agrupar y para el motivo del hilo. */
  clase:
    | 'pide_persona'
    | 'envio_mal'
    | 'no_llego'
    | 'cobro'
    | 'devolucion'
    | 'legal'
    | 'salud'
    | 'enojo'
    | 'pago_asistido'
    | 'otro';
  urgencia: Urgencia;
  /** Una línea, en español llano: qué pasa. Va en el aviso. */
  porQue: string;
}

interface Señal {
  clase: Escalada['clase'];
  urgencia: Urgencia;
  porQue: string;
  patrones: RegExp[];
}

/**
 * "Estafa" como acusación. Como pregunta —"¿es una estafa?"— es la duda de
 * alguien que todavía no compró, y la contesta el agente: escalarla en
 * silencio dejaba sin respuesta justo al que había que tranquilizar.
 */
const ESTAFA = /(?<![\wáéíóúñ])estafa(dor|ron|ste|n)?(?![\wáéíóúñ])/i;
const PREGUNTA_DE_CONFIANZA = /(?<![\wáéíóúñ])(es|será|sera)\s+(una\s+)?estafa(?![\wáéíóúñ])/i;

/**
 * Las señales duras, en orden de gravedad. La primera que coincide gana: un
 * mensaje que dice "no me llegó y voy a hacer la denuncia" es antes un reclamo
 * legal que un envío demorado, y así se anuncia.
 */
const SEÑALES: Señal[] = [
  {
    clase: 'legal',
    urgencia: 'ahora',
    porQue: 'Habla de abogados, denuncia o defensa del consumidor',
    patrones: [
      /(?<![\wáéíóúñ])abogad[oa]s?(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])denunci(a|ar|o|é|e)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])defensa del consumidor(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])(los|te|te la)\s+demand/i,
      /(?<![\wáéíóúñ])juicio(?![\wáéíóúñ])/i,
      ESTAFA,
      /(?<![\wáéíóúñ])fraude(?![\wáéíóúñ])/i,
    ],
  },
  {
    clase: 'salud',
    urgencia: 'ahora',
    porQue: 'Dice que le hizo mal a la piel o al cuerpo',
    patrones: [
      /(?<![\wáéíóúñ])(me|le)\s+(salió|salio|salieron|dio|dieron)(?![\wáéíóúñ])[^.!?]{0,40}(?<![\wáéíóúñ])(alergia|sarpullido|ronchas?|granos?|ard(or|e)|irritaci[óo]n|quemad)/i,
      /(?<![\wáéíóúñ])reacci[óo]n al[ée]rgica(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])me quem[óo](?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])(fui|ir) al m[ée]dico(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])dermat[óo]log[oa](?![\wáéíóúñ])[^.!?]{0,30}(?<![\wáéíóúñ])(dijo|me dijo)(?![\wáéíóúñ])/i,
    ],
  },
  {
    clase: 'cobro',
    urgencia: 'ahora',
    porQue: 'Reclama un cobro: doble, de más, o que no reconoce',
    patrones: [
      /(?<![\wáéíóúñ])me cobraron(?![\wáéíóúñ])[^.!?]{0,30}(?<![\wáéíóúñ])(dos veces|doble|de m[áa]s|mal)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])cobro duplicado(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])dos veces(?![\wáéíóúñ])[^.!?]{0,20}(?<![\wáéíóúñ])(cobr|debit)/i,
      /(?<![\wáéíóúñ])no reconozco(?![\wáéíóúñ])[^.!?]{0,20}(?<![\wáéíóúñ])(cobro|cargo|compra)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])desconoc(er|í|i|e) (el|ese) (cobro|cargo)(?![\wáéíóúñ])/i,
    ],
  },
  {
    // No es un reclamo: pagó por fuera de la tienda y alguien tiene que ver
    // el comprobante. Con el rótulo del reclamo, el equipo leía un problema
    // donde había una venta.
    clase: 'cobro',
    urgencia: 'ahora',
    porQue: 'Avisa que pagó o manda el comprobante: validar el pago',
    patrones: [
      /(?<![\wáéíóúñ])comprobante(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])(ya\s+)?(pagu[ée]|pagamos|pagaron|hice\s+el\s+pago)(?![\wáéíóúñ])[^.!?]{0,40}(?<![\wáéíóúñ])(bancolombia|nequi|llave|bold|addi)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])(bancolombia|nequi|llave|bold|addi)(?![\wáéíóúñ])[^.!?]{0,40}(?<![\wáéíóúñ])(no\s+(figura|aparece|pas[óo])|rechaz[óo]|fall[óo]|cobr[óo]\s+(doble|de\s+m[áa]s))(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])(ya\s+transfer(?:í|i|iste|imos|ieron)|hice\s+(?:la\s+)?transferencia|transferencia\s+(?:hecha|realizada|enviada))(?![\wáéíóúñ])/i,
    ],
  },
  {
    clase: 'envio_mal',
    urgencia: 'ahora',
    porQue: 'El envío parece ir a una dirección o ciudad incorrecta',
    patrones: [
      /(?<![\wáéíóúñ])(env[ií]o|gu[ií]a|paquete)(?![\wáéíóúñ])[^.!?]{0,50}(otra|equivocad[oa]|incorrecta)[^.!?]{0,30}(ciudad|direcci[óo]n|lugar)?/i,
      /(?<![\wáéíóúñ])(va|lleg[óo]|enviaron)(?![\wáéíóúñ])[^.!?]{0,40}(otra ciudad|ciudad equivocada|direcci[óo]n equivocada)(?![\wáéíóúñ])/i,
    ],
  },
  {
    clase: 'no_llego',
    urgencia: 'hoy',
    porQue: 'Dice que el pedido no llegó',
    patrones: [
      // "No me llegó el código / el mail / el seguimiento" no es el paquete:
      // es la pregunta de todos los días, y el agente la contesta buscando el
      // pedido. Escalarla en silencio dejaba al cliente sin su guía y al
      // comercio con un aviso por cada compra del día.
      /(?<![\wáéíóúñ])no me (lleg[óo]|ha llegado|lleg[óo] nada)(?![\wáéíóúñ])(?!\s+(?:(?:al|a mi|por|en el|en mi|el|la|los|las|un|una|ning[úu]n[oa]?|ni)\s+)?(?:c[óo]digos?|n[úu]meros?|mails?|e-?mails?|correos?|seguimientos?|links?|enlaces?|gu[ií]as?|tracking|confirmaci[óo]n|notificaci[óo]n(?:es)?|avisos?|mensajes?|qr|cup[óo]n(?:es)?|facturas?|comprobantes?)(?![\wáéíóúñ]))/i,
      /(?<![\wáéíóúñ])nunca (me )?lleg[óo](?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])figura como entregad[oa](?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])dice entregad[oa](?![\wáéíóúñ])[^.!?]{0,30}(?![\wáéíóúñ])no(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])(gu[ií]a|tracking|seguimiento)(?![\wáéíóúñ])[^.!?]{0,40}(dice|figura|marca)[^.!?]{0,25}entregad[oa][^.!?]{0,35}(pero|y)[^.!?]{0,25}(no|sin recibir)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])hace (m[áa]s de )?\d+ (d[íi]as|semanas)(?![\wáéíóúñ])[^.!?]{0,40}(?<![\wáéíóúñ])(no lleg|sin recibir|esperando)/i,
    ],
  },
  {
    clase: 'devolucion',
    urgencia: 'hoy',
    porQue: 'Pide devolución, reembolso o cancelar',
    patrones: [
      /(?<![\wáéíóúñ])quiero (la )?devoluci[óo]n(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])devolver(lo|la)?(?![\wáéíóúñ])/i,
      // "Contra reembolso" es pagar al recibir: una pregunta antes de comprar.
      /(?<!contra[\s-]?)(?<![\wáéíóúñ])reembols/i,
      /(?<![\wáéíóúñ])cancelar (el|mi) pedido(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])me arrepent[íi](?![\wáéíóúñ])/i,
    ],
  },
  {
    clase: 'pide_persona',
    urgencia: 'hoy',
    porQue: 'Pide hablar con una persona',
    patrones: [
      /(?<![\wáéíóúñ])(hablar|habla|comunicar|contactar)(?![\wáéíóúñ])[^.!?]{0,25}(?<![\wáéíóúñ])(persona|humano|alguien real|un asesor|operador|encargad)/i,
      /(?<![\wáéíóúñ])(quiero|necesito) (un|una) (persona|humano|operador)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])esto es un bot(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])(sos|eres|es) un bot(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])no quiero (hablar con )?(un )?(bot|robot|m[áa]quina)(?![\wáéíóúñ])/i,
    ],
  },
  {
    clase: 'enojo',
    urgencia: 'hoy',
    porQue: 'Está enojada y sube el tono',
    patrones: [
      /(?<![\wáéíóúñ])vergüenza(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])p[ée]sim[oa] (servicio|atenci[óo]n)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])nadie (me )?(responde|contesta|atiende)(?![\wáéíóúñ])/i,
      /(?<![\wáéíóúñ])hace (d[íi]as|semanas)(?![\wáéíóúñ])[^.!?]{0,30}(?<![\wáéíóúñ])(sin respuesta|esperando)/i,
      /(?<![\wáéíóúñ])no me toman en serio(?![\wáéíóúñ])/i,
    ],
  },
];

const MEDIO_CON_ENLACE_HUMANO = /(?<![\wáéíóúñ])(bold|addi)(?![\wáéíóúñ])/i;
const ELIGE_MEDIO = /(?<![\wáéíóúñ])(elijo|escojo|prefiero|quiero|deseo|voy a|me quedo con|usar[ée]?|pago (con|por))(?![\wáéíóúñ])/i;
const PIDE_ENLACE = /(?<![\wáéíóúñ])(env[ií]ame|mándame|mandame|pásame|pasame|necesito)(?![\wáéíóúñ])[^.!?]{0,30}(?<![\wáéíóúñ])(link|enlace)(?![\wáéíóúñ])/i;

export function pagoAsistido(ctx: Pick<ContextoEscalada, 'mensaje'>): Escalada | null {
  const mensaje = (ctx.mensaje ?? '').normalize('NFC');
  if (!MEDIO_CON_ENLACE_HUMANO.test(mensaje)) return null;
  const soloMedio = /^(bold|addi)[\s.!?]*$/i.test(mensaje.trim());
  if (!soloMedio && !ELIGE_MEDIO.test(mensaje) && !PIDE_ENLACE.test(mensaje)) {
    return null;
  }
  return {
    clase: 'pago_asistido',
    urgencia: 'hoy',
    porQue: 'Eligió un medio cuyo enlace o solicitud debe gestionar una persona',
  };
}

/**
 * Ojo con `` al final de un patrón: en JavaScript es ASCII, así que después
 * de una vocal acentuada NO hay frontera de palabra y "no me llegó el pedido"
 * no coincidía con /lleg[óo]/. Por eso los patrones cierran con un
 * lookahead de "que no siga una letra" en vez de ``.
 */

/**
 * Ojo con la frontera de palabra al final de un patron: en JavaScript es
 * ASCII, asi que despues de una vocal acentuada NO hay frontera y
 * "no me llego el pedido" no coincidia. Por eso los patrones cierran con un
 * lookahead de "que no siga una letra".
 */

/** Lo que se le da al clasificador para que entienda de qué se habla. */
export interface ContextoEscalada {
  /** Lo último que dijo la persona. */
  mensaje: string;
  /** Actual customer caption/audio, separate from generated image observations. */
  textoCliente?: string;
  /** Los últimos turnos, del más viejo al más nuevo, ya en texto plano. */
  hilo?: string[];
  /** Si el hilo ya está mirando un pedido concreto. */
  hayPedido?: boolean;
  /**
   * De quién es el gasto. Con esto la capa 2 resuelve la clave como en todos
   * lados —la del agente, la de plataforma, el entorno— y COBRA.
   *
   * Antes acá venía la variable de entorno puesta a mano por el runner: el
   * triaje de un comercio que trae SU PROPIA clave corría con la de Riverz, en
   * cada mensaje con hilo o con pedido, y no descontaba un centavo.
   */
  db: SupabaseClient;
  workspaceId: string;
  agentKeyEncrypted?: string | null;
  conversationId?: string;
  channel?: string;
}

/**
 * La capa 1: sólo texto. Se exporta aparte porque es la que corre siempre, y
 * porque es la que se puede probar sin red.
 */
export function señalDura(texto: string): Escalada | null {
  const t = (texto ?? '').normalize('NFC');
  if (t.trim().length < 4) return null;
  const preguntaDeConfianza = t.includes('?') && PREGUNTA_DE_CONFIANZA.test(t);
  for (const s of SEÑALES) {
    if (s.patrones.some((re) => re.test(t) && !(re === ESTAFA && preguntaDeConfianza))) {
      return { clase: s.clase, urgencia: s.urgencia, porQue: s.porQue };
    }
  }
  return null;
}

const SISTEMA_CLASIFICADOR = [
  'Decidís si una conversación de atención al cliente necesita que se meta una PERSONA del comercio, ya.',
  '',
  'Necesita persona cuando hay un problema REAL en curso que el asistente no puede arreglar solo. Ejemplos:',
  '- el envío va a una dirección o ciudad equivocada, o el seguimiento muestra algo que no cierra con lo que la persona dice',
  '- llegó roto, incompleto, vencido o distinto a lo que pidió',
  '- pagó y no figura el pedido, o le cobraron mal',
  '- viene reclamando hace días y no se resolvió',
  '- pide algo que el asistente no puede hacer (cambiar una dirección ya despachada, hacer una excepción, un descuento fuera de lo permitido)',
  '',
  'NO necesita persona una pregunta difícil, una duda de producto, una queja general sobre publicidad, ni alguien de mal humor sin un problema concreto. Para eso está el asistente.',
  'Tampoco escales por revisar una compra, comparar dos pedidos, enviar capturas, aclarar colores o tallas, ni por CORREGIR después de CONFIRMAR. Lee los audios transcritos y las imágenes analizadas en su orden; no inventes el contenido pendiente. Primero el asistente aclara qué quiere conservar. Escala si el cliente pide una persona o, una vez aclarado, requiere una operación fuera de sus capacidades. Un sí ambiguo no resuelve la elección.',
  '',
  'Contestá SÓLO un JSON: {"escalar": true|false, "clase": "envio_mal"|"no_llego"|"cobro"|"devolucion"|"otro", "urgencia": "ahora"|"hoy", "porQue": "una línea en español, máximo 90 caracteres, diciendo qué pasa"}',
].join('\n');

/**
 * LAS PREGUNTAS PARA JEV. Tres condiciones literales y dos clasificaciones,
 * todas sobre el mismo estado y en una sola llamada.
 *
 * Tres condiciones y no una porque Jev contesta lo que está escrito: "¿hay un
 * problema real?" esconde adentro "¿el envío va a otro lado?", "¿pide algo que
 * no puedo dar?", y cada una se pierde si se pregunta la otra. La de destino
 * está aparte porque es el caso de Rosanna: comparar dos nombres de ciudad es
 * una pregunta directa, y hecha así Jev la contesta con 0,97; metida adentro de
 * "problema real" bajaba a 0,4.
 *
 * `clase` y `urgencia` llevan una opción de "ninguno" a propósito: sin ella el
 * modelo tiene que elegir un problema aunque no haya, y la probabilidad de la
 * clase deja de significar nada.
 */
export const PREGUNTAS_ESCALADA = {
  destino_distinto: {
    type: 'noul',
    instructions: {
      question:
        '¿El envío está yendo a una ciudad o lugar distinto de donde la persona dice que vive o que quiere recibirlo?',
      compare: [
        'la ciudad o lugar de destino que aparece en `conversacion` (seguimiento, guía, captura)',
        'la ciudad o dirección que la persona menciona en `ultimo_mensaje`',
      ],
      focus: 'Compara los nombres de lugar. Si son ciudades distintas, la respuesta es sí.',
    },
    criteria: {
      true: 'El seguimiento dice que va a una ciudad y la persona dice que vive en otra; o pide que lo manden a otra ciudad de la que ya figura.',
      false: 'No se menciona ningún destino, o coinciden, o no hay envío en juego.',
    },
  },
  problema_en_curso: {
    type: 'noul',
    instructions: {
      question:
        '¿La persona describe un problema REAL y concreto en curso con su pedido, envío, pago o producto?',
      inspect: ['`ultimo_mensaje`', '`conversacion`'],
      focus: 'Un hecho que ya pasó o está pasando, no una duda ni una opinión.',
    },
    criteria: {
      true: 'El envío va a una dirección o ciudad equivocada; el seguimiento no cierra con lo que la persona dice; llegó roto, incompleto, vencido o distinto; pagó y no figura; le cobraron mal; viene reclamando hace días sin solución.',
      false: 'Pregunta de producto, duda difícil, comparación de precios o pedidos, revisión de colores y tallas antes del despacho, CORREGIR después de CONFIRMAR, capturas o audios que aclaran una elección; queja general sobre la publicidad o el precio, mal humor sin un hecho concreto, conversación de compra normal.',
    },
  },
  pide_fuera_de_alcance: {
    type: 'noul',
    instructions: {
      question:
        '¿La persona pide un cambio sobre un pedido ya hecho, o algo que un asistente automático no puede hacer y tiene que autorizar o coordinar una persona del comercio?',
      inspect: ['`ultimo_mensaje`', '`conversacion`'],
    },
    criteria: {
      true: 'Un cambio concreto ya aclarado y confirmado que el asistente no puede ejecutar en un pedido existente; mandarlo a una sucursal o punto de retiro; coordinar día u horario de entrega; una excepción a la política; un precio, descuento o reembolso fuera de lo ofrecido; combinar pedidos; adelantar una entrega.',
      false: 'Pulsar CORREGIR sin indicar el dato; dudas sobre lo que compró; pedir ver referencias o comparar dos pedidos; aclarar colores, tallas o cantidades antes de confirmar cuál conservar; preguntas normales, elegir producto o medio de pago antes de comprar, pedir el seguimiento, preguntar cuánto tarda o cuánto cuesta.',
    },
  },
  pago_por_confirmar: {
    type: 'noul',
    instructions: {
      question:
        '¿La persona dice que ya pagó, o manda un comprobante, captura o archivo de pago, y falta que el comercio lo confirme?',
      inspect: ['`ultimo_mensaje`', '`ultimo_mensaje_es_adjunto`', '`conversacion`'],
      focus: 'Un pago que la persona da por hecho y que del lado del comercio nadie confirmó todavía.',
    },
    criteria: {
      true: 'Dice que ya pagó, transfirió o abonó; pregunta si llegó el pago; manda un archivo o imagen después de que se le pidió el comprobante; el pedido figura pendiente de pago aunque dice que pagó.',
      false: 'Pregunta cómo pagar, elige un medio de pago sin haber pagado, o el pago ya fue confirmado en la conversación.',
    },
  },
  pedido_no_encontrado: {
    type: 'noul',
    instructions: {
      question:
        '¿El asistente dijo en `conversacion` que no encuentra el pedido de la persona, y la persona insiste o da más datos (mail, teléfono, fecha, número) para que lo busquen?',
      inspect: ['`conversacion`', '`ultimo_mensaje`'],
    },
    criteria: {
      true: 'El asistente respondió que no le aparece ningún pedido con esos datos y la persona sigue dando datos, insiste en que compró, o dice que ya habló muchas veces.',
      false: 'El pedido se encontró, o la persona todavía no dio ningún dato, o no está hablando de un pedido suyo.',
    },
  },
  clase: {
    type: 'choice',
    instructions: 'Si hay un problema, ¿de qué tipo es? Mira `ultimo_mensaje` y `conversacion`.',
    criteria: {
      envio_mal: 'El envío va a una dirección o ciudad equivocada, o el seguimiento no coincide con donde vive la persona.',
      no_llego: 'El pedido no llegó, figura entregado sin recibirlo, o lleva días demorado.',
      cobro: 'Pagó y no figura, cobro doble o incorrecto, comprobante mandado y sin confirmar, pago pendiente de validar.',
      devolucion: 'Llegó roto, incompleto, vencido o distinto; quiere devolver, cambiar o cancelar.',
      otro: 'Otro problema real: el pedido no aparece en el sistema, pide un cambio o una excepción, o algo que no es ninguna de las anteriores.',
      ninguno: 'No hay ningún problema en curso.',
    },
  },
  urgencia: {
    type: 'choice',
    instructions: '¿Qué tan rápido tiene que intervenir una persona del comercio?',
    criteria: {
      ahora: 'El daño crece con cada hora: un envío yendo al lugar equivocado, un cobro incorrecto, un producto que hizo daño.',
      hoy: 'Hay que atenderlo pero puede esperar unas horas: una devolución, un pedido demorado, una excepción.',
      no_hace_falta: 'No hace falta que intervenga nadie.',
    },
  },
} as const;

export type RespuestasEscalada = RespuestasDe<typeof PREGUNTAS_ESCALADA>;

/**
 * Los umbrales. Salen de `scripts/jev-escalada-validar.ts` corrido el
 * 2026-09-19 sobre 100 escaladas reales de Haiku y 100 conversaciones que no
 * escalaron (90 días, tres comercios). En las que no escalaron, "problema"
 * queda en 0,03 la mitad de las veces y por debajo de 0,46 el 95 %; en las que
 * sí, la mitad pasa de 0,5. Cada condición tiene su umbral porque cada una es
 * más o menos literal: comparar dos ciudades se contesta con 0,97 o con 0,05,
 * "hay un problema" tiene grises. Escalar de más es peor que no escalar.
 */
const UMBRAL_PROBLEMA = 0.5;
const UMBRAL_DESTINO = 0.7;
const UMBRAL_FUERA_DE_ALCANCE = 0.6;
const UMBRAL_PAGO = 0.6;
const UMBRAL_PEDIDO_NO_ENCONTRADO = 0.6;

/** Lo que dice el aviso cuando no hay quien redacte la línea. */
const POR_QUE_FIJO: Record<Escalada['clase'], string> = {
  envio_mal: 'El envío parece ir a una dirección o ciudad incorrecta',
  no_llego: 'Dice que el pedido no llegó o viene demorado',
  cobro: 'Reclama un cobro: pagó y no figura, doble o de más',
  devolucion: 'Llegó mal o quiere devolver, cambiar o cancelar',
  otro: 'Hay un problema que necesita una persona',
  pide_persona: 'Pide hablar con una persona',
  legal: 'Habla de abogados, denuncia o defensa del consumidor',
  salud: 'Dice que le hizo mal a la piel o al cuerpo',
  enojo: 'Está enojada y sube el tono',
  pago_asistido: 'Eligió un medio cuyo enlace o solicitud debe gestionar una persona',
};

/**
 * De las respuestas de Jev a una escalada, o a nada. Pura, para poder
 * probarla sin red. Es la única política: los umbrales viven acá y no en el
 * modelo.
 */
export function escaladaDesdeJev(
  r: RespuestasEscalada
): Omit<Escalada, 'porQue'> | null {
  const destino = r.destino_distinto.noul >= UMBRAL_DESTINO;
  const pago = r.pago_por_confirmar.noul >= UMBRAL_PAGO;
  const escalar =
    r.problema_en_curso.noul >= UMBRAL_PROBLEMA ||
    destino ||
    pago ||
    r.pide_fuera_de_alcance.noul >= UMBRAL_FUERA_DE_ALCANCE ||
    r.pedido_no_encontrado.noul >= UMBRAL_PEDIDO_NO_ENCONTRADO;
  if (!escalar) return null;
  // La clase que Jev eligió, salvo que diga "ninguno" con una condición dando
  // que sí: ahí gana la condición, que es más literal, y la clase es la de esa
  // condición o "otro".
  let clase: Escalada['clase'];
  if (r.clase.choice !== 'ninguno') clase = r.clase.choice;
  else if (destino) clase = 'envio_mal';
  else if (pago) clase = 'cobro';
  else clase = 'otro';
  return {
    clase,
    urgencia: r.urgencia.choice === 'ahora' ? 'ahora' : 'hoy',
  };
}

/**
 * La capa 2 con Jev: decide en ~300 ms y por ~$0,00004, contra ~$0,001 y uno o
 * dos segundos de Haiku. La LÍNEA del aviso ("qué pasa") la sigue escribiendo
 * Haiku, pero sólo cuando hay escalada, que es una de cada veinte o treinta
 * veces: Jev no redacta, y una línea concreta le ahorra a quien atiende los
 * primeros treinta segundos del caso. Si no la puede escribir, va la fija de
 * la clase; el aviso sale igual.
 */
/** `undefined` = Jev no contestó (caído o sin llave): que decida Haiku. */
async function clasificarConJev(ctx: ContextoEscalada): Promise<Escalada | null | undefined> {
  const hilo = (ctx.hilo ?? []).slice(-30);
  const resultado = await preguntarJev({
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    concepto: 'ia_clasificacion',
    detalle: { para: 'escalada', conversacion: ctx.conversationId, canal: ctx.channel },
    state: {
      conversacion: hilo,
      ultimo_mensaje: ctx.mensaje.slice(0, 600),
      // "[Imagen]" o "comprobante_1795.pdf" son un adjunto, no un texto: se
      // le dice para que no lo lea como una palabra rara.
      ultimo_mensaje_es_adjunto: esAdjunto(ctx.mensaje),
      hay_pedido: Boolean(ctx.hayPedido),
    },
    questions: PREGUNTAS_ESCALADA,
  });
  if (!resultado) return undefined;
  const decision = escaladaDesdeJev(resultado.answers);
  if (!decision) return null;
  return {
    ...decision,
    porQue: (await redactarPorQue(ctx, hilo)) ?? POR_QUE_FIJO[decision.clase],
  };
}

/** Lo que queda como texto cuando el mensaje era un archivo o una imagen. */
export function esAdjunto(mensaje: string): boolean {
  const t = mensaje.trim();
  return (
    /^\[(imagen|image|unsupported|audio|video|documento|document|sticker|archivo|file)\]$/i.test(t) ||
    /^[\w.-]+\.(pdf|jpe?g|png|webp|heic|docx?)$/i.test(t)
  );
}

async function redactarPorQue(
  ctx: ContextoEscalada,
  hilo: string[]
): Promise<string | null> {
  try {
    const linea = await completeTextMedido(ctx.db, {
      workspaceId: ctx.workspaceId,
      agentKeyEncrypted: ctx.agentKeyEncrypted,
      concepto: 'ia_clasificacion',
      detalle: { para: 'escalada_por_que', conversacion: ctx.conversationId, canal: ctx.channel },
      tier: 'triage',
      system:
        'Una persona del comercio va a recibir un aviso de que esta conversación necesita que se meta. Escribí en UNA línea, en español llano y en máximo 90 caracteres, qué le pasa a la clienta. Sin comillas, sin JSON, sin encabezado.',
      user: [
        hilo.length ? `CONVERSACIÓN:\n${hilo.join('\n')}` : null,
        `ÚLTIMO MENSAJE: ${ctx.mensaje.slice(0, 600)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      maxTokens: 60,
      effort: 'low',
    });
    const limpia = (linea ?? '').replace(/^["'“”\s]+|["'“”.\s]+$/g, '').replace(/\s+/g, ' ');
    return limpia.length >= 8 ? limpia.slice(0, 90) : null;
  } catch {
    return null;
  }
}

/**
 * La capa 2. Corre SÓLO si la capa 1 no dijo nada: es la que cuesta plata y
 * la que puede fallar. Ante cualquier duda —sin clave, JSON roto, timeout—
 * devuelve null y todo sigue como antes: escalar de más es peor que no
 * escalar, porque un aviso que suena por cualquier cosa se empieza a ignorar.
 *
 * Con `TYPESAFE_API_KEY` decide Jev; sin ella, o si Jev no contesta (caído,
 * timeout, fusible abierto), Haiku como siempre. Una caída de TypeSafe no
 * puede dejar de escalar lo que antes se escalaba.
 */
async function clasificar(ctx: ContextoEscalada): Promise<Escalada | null> {
  if (hayJev()) {
    const porJev = await clasificarConJev(ctx);
    if (porJev !== undefined) return porJev;
  }
  return clasificarConHaiku(ctx);
}

async function clasificarConHaiku(ctx: ContextoEscalada): Promise<Escalada | null> {
  const hilo = (ctx.hilo ?? []).slice(-30).join('\n');
  try {
    const salida = await completeTextMedido(ctx.db, {
      workspaceId: ctx.workspaceId,
      agentKeyEncrypted: ctx.agentKeyEncrypted,
      concepto: 'ia_clasificacion',
      detalle: { para: 'escalada', conversacion: ctx.conversationId, canal: ctx.channel },
      tier: 'triage',
      system: SISTEMA_CLASIFICADOR,
      user: [
        hilo ? `CONVERSACIÓN:\n${hilo}` : null,
        `ÚLTIMO MENSAJE: ${ctx.mensaje.slice(0, 600)}`,
        ctx.hayPedido ? 'Hay un pedido de esta persona en la conversación.' : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      maxTokens: 200,
      // `tier: 'triage'` ya elige el modelo barato y `completeText` sabe qué
      // parámetros acepta: acá no se le agrega esfuerzo a mano.
      effort: 'low',
    });
    if (!salida) return null;
    const json = salida.slice(salida.indexOf('{'), salida.lastIndexOf('}') + 1);
    const o = JSON.parse(json) as {
      escalar?: boolean;
      clase?: string;
      urgencia?: string;
      porQue?: string;
    };
    if (!o.escalar) return null;
    const clases: Escalada['clase'][] = [
      'envio_mal',
      'no_llego',
      'cobro',
      'devolucion',
      'otro',
    ];
    return {
      clase: clases.includes(o.clase as Escalada['clase'])
        ? (o.clase as Escalada['clase'])
        : 'otro',
      urgencia: o.urgencia === 'ahora' ? 'ahora' : 'hoy',
      porQue: (o.porQue ?? '').trim().slice(0, 90) || 'Hay un problema que necesita una persona',
    };
  } catch {
    return null;
  }
}

/**
 * ¿Esto necesita una persona? Las dos capas, en orden.
 *
 * El clasificador no corre en cada mensaje: sólo cuando la conversación ya
 * viene con algo cargado —un pedido en juego o varios turnos— porque es ahí
 * donde aparecen los problemas reales, y así una pregunta suelta no paga una
 * llamada al modelo.
 */
export async function detectarEscalada(
  ctx: ContextoEscalada,
): Promise<Escalada | null> {
  // OCR may describe a refund button on an order page. That is evidence to
  // interpret in context, not a customer request to refund the order.
  const dura = señalDura(ctx.textoCliente ?? ctx.mensaje);
  if (dura) return dura;
  // A correction button carries no change details. Ask before classifying.
  if (/^(corregir|correct)$/i.test(ctx.mensaje.trim())) return null;
  const pago = pagoAsistido(ctx);
  if (pago) return pago;
  // Elegir transferencia antes de comprar es una preferencia de pago, no un
  // incidente. El checkout sabe marcarla y aplicar el crédito configurado;
  // no la mandamos al clasificador, que no conoce esa configuración y puede
  // confundir la petición del descuento válido con una excepción manual.
  const eligeTransferencia =
    /(?<![\wáéíóúñ])(transferencia|transferir)(?![\wáéíóúñ])/i.test(ctx.mensaje) &&
    /(?<![\wáéíóúñ])(comprar|pagar|checkout|enlace|link)(?![\wáéíóúñ])/i.test(ctx.mensaje)
  if (eligeTransferencia) return null;
  // Un botón de la recuperación ("CONFIRMAR", "MANTENER CONTRAENTREGA") es
  // una respuesta a lo que se le ofreció, no un incidente. Jev lo leía como
  // "pide cambiar el pago de un pedido hecho" (0,6) y lo escalaba.
  if (recoveryButtonKind(ctx.mensaje)) return null;
  const conversacionCargada = ctx.hayPedido || (ctx.hilo?.length ?? 0) >= 3;
  if (!conversacionCargada) return null;
  return clasificar(ctx);
}

/**
 * Lo que el asistente hace en el turno en que el triaje vio un problema.
 *
 * Antes la IA se callaba y la conversación pasaba a una persona sin mirar
 * nada: al que escribía "no me llegó" nadie le buscaba el pedido, y el
 * comprobante que mandó nadie lo leía hasta que alguien abría la bandeja.
 * Ahora verifica con lo que tiene, contesta lo que encontró y avisa que sigue
 * una persona. La conversación pasa al equipo igual: este turno es el último.
 */
export function instruccionDeTraspaso(porQue: string): string {
  return [
    '## Revisión interna del caso (no describas el traspaso al cliente)',
    `El triaje vio: ${porQue}. Después de esta respuesta la conversación queda para revisión interna; tú no vuelves a contestar automáticamente.`,
    'Antes de responder, verifica con tus herramientas todo lo que puedas:',
    '- Si hay un pedido (lo menciona, hay número, teléfono o correo), búscalo con lookup_order y mira su estado, pago, guía y seguimiento.',
    '- Si mandó fotos, capturas, comprobantes o PDF, míralos y di en concreto qué ves (monto, fecha, estado del envío, daño).',
    '- Si falta un dato necesario para revisar el caso (número de pedido, foto, comprobante), pídelo en esta misma respuesta.',
    'Contesta con lo que encontraste, en concreto y con calma. Habla en primera persona como la tienda: "Lo reviso y te confirmo por aquí". Nunca digas "lo tiene que revisar el equipo", "te paso con una persona", "lo verá un agente" ni atribuyas la atención a terceros. La escalada es interna y no cambia quién habla con el cliente. No prometas reembolsos, reenvíos, cambios ni plazos sin confirmación real. Si es un tema legal, no discutas el fondo. No afirmes ser una persona humana si te preguntan si eres IA.',
  ].join('\n');
}
