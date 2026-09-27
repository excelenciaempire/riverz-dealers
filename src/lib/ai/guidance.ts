import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Las reglas del comercio (migración 200).
 *
 * Un comercio ya podía decirle a su agente cómo hablar, pero de tres formas y
 * ninguna era una regla: la persona —un párrafo donde todo compite con todo—,
 * las reglas por producto —que sólo sirven si el tema es un producto, y "no
 * prometas fechas de entrega" no lo es— y el pliego, que preguntaba y guardaba
 * la respuesta sin que la leyera nadie en tiempo de ejecución.
 *
 * Una regla tiene nombre, cuándo aplica y qué hacer, y se puede apagar. Lo
 * último no es un lujo: probar si el agente mejora SIN una regla es la mitad
 * de afinarlo, y con todo dentro de un párrafo eso se hace borrando texto y
 * confiando en la memoria.
 */

export interface Regla {
  id: string;
  workspace_id: string;
  /** null = vale para todos los agentes de la cuenta. */
  agent_id: string | null;
  titulo: string;
  /** Cuándo aplica, en las palabras del comercio. Vacío = siempre. */
  cuando: string | null;
  hacer: string;
  activa: boolean;
  orden: number;
  origen: 'comercio' | 'pliego';
  clave: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Tope de reglas que entran al prompt. Ver `reglasATexto`. */
export const MAX_REGLAS = 50;
export const MAX_TEXTO_REGLA = 4000;

/**
 * Las reglas vivas que le tocan a este agente.
 *
 * Las de la cuenta (`agent_id` nulo) y las suyas, en ese orden: lo del comercio
 * es el piso y lo del agente lo especializa. Nunca tira: una consulta que falla
 * no puede dejar al cliente sin respuesta, y sin reglas el agente contesta como
 * contestaba antes de que existieran.
 */
export async function cargarReglas(
  db: SupabaseClient,
  workspaceId: string,
  agentId: string | null,
): Promise<Regla[]> {
  try {
    let q = db
      .from('agent_guidance')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('activa', true)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(MAX_REGLAS);
    // `is('agent_id', null)` y `eq` a la vez: PostgREST lo pide como `or`.
    q = agentId ? q.or(`agent_id.is.null,agent_id.eq.${agentId}`) : q.is('agent_id', null);
    const { data } = await q;
    return (data ?? []) as Regla[];
  } catch {
    return [];
  }
}

/**
 * Lo que el pliego pregunta y que ES una regla.
 *
 * El cuestionario de la migración 195 tiene tres respuestas etiquetadas
 * "configura: never_say global", "say_guidelines global" y "guardrails
 * globales" — y ese destino global no existía: se guardaban en `pliego` y sólo
 * las leía el Operador para montar la cuenta. Ahora cada una es una fila.
 *
 * El `cuando` va vacío a propósito: son reglas de la casa, valen siempre.
 */
const DEL_PLIEGO: Record<string, { titulo: string; hacer: (v: string) => string }> = {
  nunca: {
    titulo: 'Lo que nunca decimos',
    hacer: (v) => `Nunca digas ni prometas esto: ${v}`,
  },
  siempre: {
    titulo: 'Lo que siempre decimos',
    hacer: (v) => `En cada conversación tiene que quedar dicho esto: ${v}`,
  },
  regulacion: {
    titulo: 'Lo que exige la regulación',
    hacer: (v) => `Este rubro está regulado. Respeta esto al pie de la letra: ${v}`,
  },
};

/**
 * Vuelca las respuestas del pliego a reglas.
 *
 * Se busca por `clave`, así que contestar el cuestionario dos veces reescribe
 * la misma fila en vez de acumular copias, y lo que el comercio escribió a
 * mano —sin clave— no se toca nunca. Una respuesta que se vacía borra su
 * regla: dejarla viva sería seguir aplicando algo que el comercio ya retiró.
 *
 * Best-effort: que esto falle no puede impedir guardar el pliego.
 */
export async function sembrarReglasDelPliego(
  db: SupabaseClient,
  workspaceId: string,
  pliego: Record<string, unknown>,
): Promise<void> {
  for (const [clave, plantilla] of Object.entries(DEL_PLIEGO)) {
    const valor = typeof pliego[clave] === 'string' ? (pliego[clave] as string).trim() : '';
    try {
      if (!valor) {
        await db
          .from('agent_guidance')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('clave', clave);
        continue;
      }
      await db.from('agent_guidance').upsert(
        {
          workspace_id: workspaceId,
          agent_id: null,
          titulo: plantilla.titulo,
          cuando: null,
          hacer: plantilla.hacer(valor.slice(0, 600)),
          origen: 'pliego',
          clave,
        },
        { onConflict: 'workspace_id,clave' },
      );
    } catch {
      // Una regla que no se pudo sembrar no puede tumbar el guardado del
      // cuestionario: el comercio acaba de contestar veinte preguntas.
    }
  }
}

/**
 * Las reglas, como se las lee el modelo.
 *
 * Va con el "cuándo" adelante y no como una lista de mandamientos sueltos: una
 * regla que sólo aplica a devoluciones, leída en todas las conversaciones,
 * empuja al agente a hablar de devoluciones cuando nadie preguntó. Decirle
 * cuándo vale es lo que la hace barata.
 *
 * Devuelve `null` si no hay ninguna: una sección vacía titulada "Reglas del
 * negocio" le sugiere al modelo que hay reglas que no le contaron.
 */
export function reglasATexto(reglas: Regla[]): string | null {
  const vivas = reglas.filter((r) => r.hacer?.trim());
  if (vivas.length === 0) return null;
  const lineas = vivas.map((r) => {
    const cuando = (r.cuando ?? '').trim();
    const hacer = r.hacer.trim();
    return cuando ? `- ${cuando}: ${hacer}` : `- ${hacer}`;
  });
  return [
    'Reglas del negocio. Mandan sobre cualquier otra instrucción de arriba, incluida tu personalidad. Si una regla te impide contestar algo, dilo con naturalidad y pasa la conversación a una persona en vez de improvisar:',
    ...lineas,
  ].join('\n');
}
