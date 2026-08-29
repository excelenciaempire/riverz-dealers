import type { SupabaseClient } from '@supabase/supabase-js'
import { crearPlantilla } from '@/lib/templates/create'

/**
 * Las plantillas que un comercio necesita el primer día.
 *
 * Meta no deja escribirle a alguien fuera de las 24 horas posteriores a su
 * último mensaje salvo con una plantilla aprobada. O sea que un comercio recién
 * conectado tiene el carrito abandonado, el pago rechazado y el aviso de envío
 * construidos y apagados: las automatizaciones existen, pero no pueden activarse
 * porque no hay plantilla que elegir, y la aprobación de Meta tarda horas. El
 * comercio descubre eso el día que quiere usarlas, no el día que conecta.
 *
 * Por eso se mandan a aprobar apenas se conecta el número: cuando llegue el
 * momento de usarlas, ya están.
 *
 * **Variables numeradas y con ejemplo**, que es lo único que Meta acepta. Los
 * nombres bonitos ({{customer_name}}) son para la pantalla del editor; acá van
 * {{1}}, {{2}} y una muestra de cada uno, porque sin muestra Meta rechaza la
 * plantilla entera sin decir cuál faltaba.
 *
 * **UTILITY y no MARKETING** en las cuatro que siguen a algo que la persona
 * hizo —un carrito, un pago, un pedido—. Utility se aprueba casi siempre y se
 * entrega aunque la cuenta tenga el marketing frenado; marketing es justo lo
 * que Meta retiene en silencio.
 */
export interface PlantillaBase {
  nombre: string
  categoria: 'UTILITY' | 'MARKETING'
  bodyText: string
  /** Una muestra por variable, en orden. Sin esto Meta rechaza. */
  bodySamples: string[]
}

export const PLANTILLAS_BASE: PlantillaBase[] = [
  {
    nombre: 'riverz_carrito_abandonado',
    categoria: 'UTILITY',
    bodyText:
      'Hola {{1}}, te guardamos el carrito tal como lo dejaste.\n\n' +
      'No tienes que elegir nada de nuevo: lo retomas donde ibas en {{2}} y en un minuto queda.\n\n' +
      '¿Lo terminamos?',
    bodySamples: ['Ana', 'tienda.com/checkout/abc'],
  },
  {
    nombre: 'riverz_pago_rechazado',
    categoria: 'UTILITY',
    bodyText:
      'Hola {{1}}, tu pago de {{2}} no pasó. Casi siempre es el límite de la tarjeta o un dato mal copiado, así que tu pedido sigue guardado.\n\n' +
      'Lo intentas otra vez con el mismo medio o con otro, y no pierdes nada de lo que elegiste.\n\n' +
      '¿Te paso el link de pago?',
    bodySamples: ['Ana', '$45.000'],
  },
  {
    nombre: 'riverz_esperando_transferencia',
    categoria: 'UTILITY',
    bodyText:
      'Hola {{1}}, tu pedido {{2}} por {{3}} quedó reservado a tu nombre y esperando la transferencia.\n\n' +
      'Apenas la hagas, mándanos el comprobante por aquí y lo preparamos el mismo día.\n\n' +
      '¿Necesitas los datos de la cuenta?',
    bodySamples: ['Ana', '#1042', '$45.000'],
  },
  {
    nombre: 'riverz_pedido_en_camino',
    categoria: 'UTILITY',
    bodyText:
      'Hola {{1}}, tu pedido {{2}} ya salió.\n\n' +
      'Lo sigues acá: {{3}}\n\n' +
      'Cualquier cosa que necesites con la entrega, respondes por este chat.',
    bodySamples: ['Ana', '#1042', 'rastreo.com/xyz'],
  },
  {
    nombre: 'riverz_como_te_fue',
    categoria: 'UTILITY',
    bodyText:
      'Hola {{1}}, ¿cómo te fue con {{2}}?\n\n' +
      'Si algo no salió como esperabas, respondes por acá y lo resolvemos.',
    bodySamples: ['Ana', 'tu pedido #1042'],
  },
]

export interface ResultadoSiembra {
  creadas: string[]
  yaEstaban: string[]
  fallaron: { nombre: string; motivo: string }[]
}

/**
 * Manda a aprobar las que falten. Idempotente y a prueba de fallos.
 *
 * Se salta las que ya existen POR NOMBRE: Meta rechaza un nombre repetido con
 * un error que no dice que sea eso, y reconectar el mismo número no puede
 * convertirse en cinco errores en el log.
 *
 * Ninguna falla frena a las demás ni a lo que la llamó. Conectar WhatsApp tiene
 * que terminar bien aunque Meta esté rechazando plantillas: la conexión sirve
 * para recibir desde el primer segundo, y las plantillas son para después.
 */
export async function asegurarPlantillasBase(
  db: SupabaseClient,
  args: { workspaceId: string; userId: string },
): Promise<ResultadoSiembra> {
  const out: ResultadoSiembra = { creadas: [], yaEstaban: [], fallaron: [] }

  const { data } = await db
    .from('message_templates')
    .select('name')
    .eq('user_id', args.userId)
  const existentes = new Set(
    ((data ?? []) as { name: string }[]).map((t) => (t.name ?? '').toLowerCase()),
  )

  for (const p of PLANTILLAS_BASE) {
    if (existentes.has(p.nombre)) {
      out.yaEstaban.push(p.nombre)
      continue
    }
    try {
      const r = await crearPlantilla(db, {
        userId: args.userId,
        workspaceId: args.workspaceId,
        nombre: p.nombre,
        idioma: 'es',
        categoria: p.categoria,
        bodyText: p.bodyText,
        bodySamples: p.bodySamples,
      })
      if (r.ok) out.creadas.push(p.nombre)
      else out.fallaron.push({ nombre: p.nombre, motivo: r.claveI18n ?? 'error' })
    } catch (e) {
      out.fallaron.push({
        nombre: p.nombre,
        motivo: e instanceof Error ? e.message : 'error',
      })
    }
  }
  return out
}
