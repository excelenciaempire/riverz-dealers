import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cuánto esperar a que la persona termine de escribir.
 *
 * El agente ya agrupaba ráfagas: espera unos segundos y, si mientras tanto
 * llegó otro mensaje, ese turno se descarta y contesta el del último. Eso
 * funciona — medido sobre 30 días de producción, en WhatsApp sólo 2 de 38
 * mensajes del cliente llegaron dentro de los 15 s posteriores a nuestra
 * respuesta, o sea que casi nunca cortamos a nadie a mitad de frase.
 *
 * Pero la espera es un NÚMERO FIJO, y la gente no escribe toda al mismo ritmo.
 * De 366 pares de mensajes seguidos del mismo cliente, el 19% tiene entre 15 y
 * 30 segundos de separación: quien escribe a ese ritmo queda cortado siempre,
 * por más que el promedio esté bien. Subir el número para todos es peor —
 * castiga al que escribe rápido y a quien manda una sola línea.
 *
 * Así que se mide el ritmo de ESA persona en ESA conversación, igual que el
 * vigilante de canales callados mide el silencio contra el ritmo real del
 * canal. Y sólo cuando estamos A MITAD de una ráfaga: si el mensaje anterior
 * no es suyo, la persona recién arranca y no hay nada que esperar.
 */

/** Techo absoluto. Más que esto no es "está escribiendo", es "no contestan". */
export const ESPERA_MAXIMA_SEGUNDOS = 45;

/** Cuántos mensajes suyos se miran para sacarle el ritmo. */
const MUESTRA = 12;

/** Margen sobre su ritmo: escribir no es un metrónomo. */
const HOLGURA = 1.3;

export interface RitmoDeEscritura {
  /** Segundos a esperar, ya acotados. */
  espera: number;
  /** Por qué. Va al log: una espera sin explicación parece un cuelgue. */
  motivo: 'sin_datos' | 'no_esta_en_rafaga' | 'ritmo_propio' | 'configurado';
}

/**
 * La espera para este turno.
 *
 * Nunca por debajo de `base` —lo que el comercio configuró es un piso, no una
 * sugerencia— y nunca por encima del techo. Si algo falla devuelve `base`: una
 * consulta rota no puede dejar al cliente esperando ni dejarlo sin respuesta.
 */
export async function esperaParaEsteTurno(
  db: SupabaseClient,
  conversationId: string,
  inboundMessageId: string,
  base: number,
): Promise<RitmoDeEscritura> {
  try {
    const { data } = await db
      .from('messages')
      .select('id, sender_type, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MUESTRA);
    const filas = (data ?? []) as Array<{
      id: string;
      sender_type: string;
      created_at: string;
    }>;

    // El mensaje inmediatamente anterior al que dispara este turno. Si no es
    // del cliente, recién arranca a escribir: no hay ráfaga que esperar, y
    // hacerle esperar de más a quien manda una sola línea es el costo que este
    // ajuste no puede pagar.
    const i = filas.findIndex((m) => m.id === inboundMessageId);
    const anterior = i >= 0 ? filas[i + 1] : filas[1];
    if (!anterior || anterior.sender_type !== 'customer') {
      return { espera: base, motivo: 'no_esta_en_rafaga' };
    }

    // Los huecos entre mensajes SUYOS seguidos. Los que cruzan una respuesta
    // nuestra no cuentan: ahí no estaba escribiendo, estaba leyendo.
    const suyos = filas.filter((m) => m.sender_type === 'customer');
    const huecos: number[] = [];
    for (let k = 0; k < suyos.length - 1; k++) {
      const a = new Date(suyos[k].created_at).getTime();
      const b = new Date(suyos[k + 1].created_at).getTime();
      const seg = (a - b) / 1000;
      // Más de dos minutos ya no es "seguir escribiendo": es otro momento.
      if (Number.isFinite(seg) && seg > 0 && seg <= 120) huecos.push(seg);
    }
    if (huecos.length < 2) return { espera: base, motivo: 'sin_datos' };

    // La mediana, no el promedio: un solo hueco largo no puede definirle el
    // ritmo a nadie.
    huecos.sort((a, b) => a - b);
    const mediana = huecos[Math.floor(huecos.length / 2)];
    const propuesta = Math.ceil(mediana * HOLGURA);

    return {
      espera: Math.min(ESPERA_MAXIMA_SEGUNDOS, Math.max(base, propuesta)),
      motivo: propuesta > base ? 'ritmo_propio' : 'configurado',
    };
  } catch {
    return { espera: base, motivo: 'sin_datos' };
  }
}
