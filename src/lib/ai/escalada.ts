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
 *      palabra de la lista y aun así es urgente.
 *
 * Lo que NO se escala: una pregunta difícil. Para eso está el agente. Escalar
 * de más entrena al comercio a ignorar los avisos, que es la única forma de
 * que un aviso deje de servir.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { completeTextMedido } from './medido';

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
      /(?<![\wáéíóúñ])estafa(dor|ron|ste|n)?(?![\wáéíóúñ])/i,
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
      /(?<![\wáéíóúñ])(transferencia|transferir|comprobante|bancolombia|nequi|llave|bold|addi)(?![\wáéíóúñ])/i,
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
      /(?<![\wáéíóúñ])no me (lleg[óo]|ha llegado|lleg[óo] nada)(?![\wáéíóúñ])/i,
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
      /(?<![\wáéíóúñ])reembols/i,
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
}

/**
 * La capa 1: sólo texto. Se exporta aparte porque es la que corre siempre, y
 * porque es la que se puede probar sin red.
 */
export function señalDura(texto: string): Escalada | null {
  const t = (texto ?? '').normalize('NFC');
  if (t.trim().length < 4) return null;
  for (const s of SEÑALES) {
    if (s.patrones.some((re) => re.test(t))) {
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
  '',
  'Contestá SÓLO un JSON: {"escalar": true|false, "clase": "envio_mal"|"no_llego"|"cobro"|"devolucion"|"otro", "urgencia": "ahora"|"hoy", "porQue": "una línea en español, máximo 90 caracteres, diciendo qué pasa"}',
].join('\n');

/**
 * La capa 2. Corre SÓLO si la capa 1 no dijo nada: es la que cuesta plata y
 * la que puede fallar. Ante cualquier duda —sin clave, JSON roto, timeout—
 * devuelve null y todo sigue como antes: escalar de más es peor que no
 * escalar, porque un aviso que suena por cualquier cosa se empieza a ignorar.
 */
async function clasificar(ctx: ContextoEscalada): Promise<Escalada | null> {
  const hilo = (ctx.hilo ?? []).slice(-6).join('\n');
  try {
    const salida = await completeTextMedido(ctx.db, {
      workspaceId: ctx.workspaceId,
      agentKeyEncrypted: ctx.agentKeyEncrypted,
      concepto: 'ia_clasificacion',
      detalle: { para: 'escalada' },
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
  const dura = señalDura(ctx.mensaje);
  if (dura) return dura;
  const conversacionCargada = ctx.hayPedido || (ctx.hilo?.length ?? 0) >= 3;
  if (!conversacionCargada) return null;
  return clasificar(ctx);
}
