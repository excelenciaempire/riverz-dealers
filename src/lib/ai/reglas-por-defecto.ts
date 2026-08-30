import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Las reglas con las que nace un asistente.
 *
 * Antes nacía con CERO. Y las reglas son justo lo que impide que invente: en
 * una sola semana de producción, un asistente sin reglas prometió pago contra
 * entrega donde no existe, opinó sobre si un cosmético servía para una
 * condición de la piel, y repitió como cierta una condición de venta sólo
 * porque la clienta la dio por hecha. Ninguna de las tres es un problema del
 * modelo: es que nadie le había dicho qué hacer.
 *
 * Estas cuatro son las que valen para CUALQUIER comercio — no hablan de un
 * rubro, un producto ni un país, sino de qué hacer cuando falta un dato. Lo
 * específico del negocio lo agrega el comercio encima, y estas se pueden
 * borrar: son un piso, no una imposición.
 *
 * Se siembran con `clave`, así que crear un segundo asistente no las duplica y
 * lo que el comercio escribió a mano —sin clave— no se toca nunca. Español
 * neutro: son instrucciones al modelo, que después habla en el registro que le
 * corresponda al cliente.
 */
export const REGLAS_POR_DEFECTO = [
  {
    clave: 'base_confirmar',
    titulo: 'Qué se confirma y qué no',
    cuando: 'No tienes un dato a mano.',
    hacer:
      'Si el dato es del PRODUCTO —de dónde es, qué tiene, cómo se usa, cuánto dura, para qué sirve— contéstalo con la ficha del producto y estas reglas, que es donde está. Solo confirmas antes de afirmar cuando el dato es EXTERNO y verificable: un número de registro, un certificado, un estudio, una factura. Dudar de todo suena peor que no saber.',
  },
  {
    clave: 'base_condiciones',
    titulo: 'Condiciones comerciales que afirma el cliente',
    cuando:
      'El cliente da por hecha una condición de venta que no confirmaste: pago contra entrega, un descuento, una promoción, un plazo de envío, una devolución, cuotas.',
    hacer:
      'No se la aceptes ni se la niegues de memoria, y NUNCA la repitas como si fuera cierta solo porque la dijo el cliente: eso es prometer en nombre del negocio. Si el dato está en la ficha del producto o en estas reglas, contéstalo con eso. Si no está, dile que lo confirmas y pasa la conversación a una persona del equipo. Vale más hacerlo esperar dos minutos que prometerle algo que después no se le puede cumplir.',
  },
  {
    clave: 'base_enlace',
    titulo: 'Nadie se queda sin a dónde ir',
    cuando:
      'Piden el precio, preguntan dónde comprar, o dicen que no les carga la página.',
    hacer:
      'Envías el enlace más específico que sirva: el del producto del que hablan; si llegaron por un anuncio y preguntan por eso, el de la página a la que llevaba; si la consulta es general, el de la tienda. Tal cual está escrito, sin acortarlo. Nunca armes una dirección de memoria.',
  },
  {
    clave: 'base_registros',
    titulo: 'Aprobaciones, registros y certificados',
    cuando:
      'Preguntan si el producto tiene un registro sanitario, un certificado, una aprobación o una habilitación.',
    hacer:
      'Si el dato está cargado en la ficha del producto, lo dices. Si no está, NO afirmas que lo tiene ni que no lo tiene: dices que lo confirmas y lo pasas a una persona. Lo que se publica sobre un registro queda escrito y se puede capturar.',
  },
] as const;

/**
 * Siembra el piso de reglas de una cuenta. Idempotente por `(cuenta, clave)`.
 *
 * Best-effort a propósito: que esto falle no puede impedir que se cree el
 * asistente. Un asistente sin reglas es peor que uno con reglas, pero mucho
 * mejor que un error al guardar.
 */
export async function sembrarReglasPorDefecto(
  db: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  try {
    // Si la cuenta ya tiene alguna regla, no se siembra: puede haberlas
    // borrado a propósito, y devolvérselas cada vez que crea un asistente
    // sería discutirle una decisión suya.
    const { data, error } = await db
      .from('agent_guidance')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(1);
    if (error || (data ?? []).length > 0) return;

    await db.from('agent_guidance').upsert(
      REGLAS_POR_DEFECTO.map((r, i) => ({
        workspace_id: workspaceId,
        agent_id: null,
        titulo: r.titulo,
        cuando: r.cuando,
        hacer: r.hacer,
        activa: true,
        orden: i,
        origen: 'base',
        clave: r.clave,
      })),
      { onConflict: 'workspace_id,clave' },
    );
  } catch {
    // Ver arriba: nunca tumba la creación del asistente.
  }
}
