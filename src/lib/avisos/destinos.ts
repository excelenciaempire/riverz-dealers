import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeToWhatsApp } from '@/lib/whatsapp/phone-utils';
import { aQuienAvisar } from '@/lib/ai/aviso-escalada';
import { stripe, stripeDisponible } from '@/lib/billing/stripe';

type AlcanceDeDestino = 'escalations' | 'notifications' | 'both';
type DestinoConfigurado = { phone?: unknown; scope?: unknown };

/**
 * A quién le escribe Riverz, en un solo lugar.
 *
 * Había cuatro caminos que decidían esto por su cuenta: el saldo mandaba a una
 * lista, la bienvenida a un teléfono, la escalada a otro y la prueba a un
 * cuarto. El resultado era que los números que el comercio carga en su perfil
 * servían para algunos avisos y no para otros, sin ninguna regla que se pudiera
 * explicar.
 *
 * Ahora la regla es una:
 *
 *  1. Los números que el comercio cargó, respetando si cada uno eligió recibir
 *     escalaciones, avisos de saldo/cobro o ambos.
 *  2. Si todavía no hay ninguno, el respaldo que resuelve `aQuienAvisar`: la
 *     cuenta recién creada no puede quedarse sin avisos por no haber pasado por
 *     Ajustes.
 *  3. En lo que es PLATA, además el teléfono de quien puso la tarjeta. Muchas
 *     veces no es la misma persona que opera, y enterarse de que la tarjeta
 *     rebotó le sirve a quien puede arreglarlo.
 *
 * **Sin duplicados.** Se comparan ya normalizados, así que «+54 9 11 6104-7646»,
 * «5491161047646» y «541161047646» son el mismo número y reciben UN mensaje.
 * Ese último caso es real y no teórico: el 9 argentino aparece o no según de
 * dónde venga el dato, y sin normalizar antes de comparar la misma persona
 * recibía dos.
 */
export type TipoDeAviso = 'operacion' | 'plata';

export async function destinosDeAviso(
  db: SupabaseClient,
  workspaceId: string,
  tipo: TipoDeAviso = 'operacion'
): Promise<string[]> {
  const salida = new Map<string, string>();
  let tuvoConfiguracionNueva = false;
  const sumar = (crudo: string | null | undefined) => {
    const limpio = normalizeToWhatsApp(crudo ?? '');
    if (limpio) salida.set(limpio, limpio);
  };

  try {
    const { data } = await db
      .from('workspaces')
      .select('alert_phone, alert_phones, alert_destinations')
      .eq('id', workspaceId)
      .maybeSingle();
    const fila = data as {
      alert_phone?: string | null;
      alert_phones?: string[] | null;
      alert_destinations?: DestinoConfigurado[] | null;
    } | null;
    const alcanceBuscado: AlcanceDeDestino =
      tipo === 'operacion' ? 'escalations' : 'notifications';
    const configurados = Array.isArray(fila?.alert_destinations)
      ? fila.alert_destinations
      : [];
    tuvoConfiguracionNueva = configurados.length > 0;

    // Una configuración nueva manda sobre la lista heredada. Así un número que
    // eligió sólo escalaciones no recibe por accidente un aviso de cobro.
    if (configurados.length > 0) {
      for (const destino of configurados) {
        const alcance = destino.scope as AlcanceDeDestino;
        if (
          typeof destino.phone === 'string' &&
          (alcance === 'both' || alcance === alcanceBuscado)
        ) {
          sumar(destino.phone);
        }
      }
    } else {
      sumar(fila?.alert_phone);
      for (const t of fila?.alert_phones ?? []) sumar(t);
    }
  } catch (e) {
    console.error('[avisos] no se pudieron leer los números del comercio', e);
  }

  // En la configuración nueva, que haya elegido "sólo el otro tipo" significa
  // exactamente no recibir este aviso. El respaldo sólo existe para las
  // cuentas que todavía no configuraron ningún destino.
  if (salida.size === 0 && !tuvoConfiguracionNueva) {
    try {
      sumar(await aQuienAvisar(db, workspaceId));
    } catch (e) {
      console.error('[avisos] no se pudo resolver el número por defecto', e);
    }
  }

  if (tipo === 'plata') {
    try {
      const { data } = await db
        .from('workspace_subscriptions')
        .select('stripe_customer_id')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      const id = (data as { stripe_customer_id?: string | null } | null)
        ?.stripe_customer_id;
      if (id && stripeDisponible()) {
        const cliente = await stripe().customers.retrieve(id);
        if (!('deleted' in cliente && cliente.deleted)) sumar(cliente.phone);
      }
    } catch (e) {
      // Que Stripe no conteste no puede dejar sin aviso al comercio.
      console.error('[avisos] no se pudo leer el teléfono de quien paga', e);
    }
  }

  return [...salida.values()];
}

/** El mismo mensaje a todos, sin que uno que falle tape a los demás. */
export async function avisarATodos(
  destinos: string[],
  mensaje: { title: string; body: string }
): Promise<{ ok: boolean; enviados: number; error?: string }> {
  if (destinos.length === 0)
    return { ok: false, enviados: 0, error: 'sin número' };
  const { sendPlatformAlert } = await import('@/lib/admin/platform-whatsapp');
  const envios = await Promise.all(
    destinos.map((to) => sendPlatformAlert({ to, ...mensaje }))
  );
  const enviados = envios.filter((e) => e.ok).length;
  return {
    ok: enviados > 0,
    enviados,
    error: envios.find((e) => !e.ok)?.error,
  };
}
