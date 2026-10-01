import { NextResponse } from 'next/server';
import { CLIENTE_DE_PRUEBA } from '@/lib/ai/nombre-de-pila';
import { pedirCambio } from '@/lib/templates/cambios';
import { borrarPlantilla } from '@/lib/templates/borrar';
import { serverError } from '@/lib/api/errors';
import {
  lugarDePrueba,
  simularDisparo,
  type AutomacionSimulada,
  type EscenarioSimulado,
  type PedidoDePrueba,
} from '@/lib/automations/simulacion';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { problemaDelTexto } from '@/lib/automations/tablero';
import {
  COLUMNAS_DE_BORRADOR,
  enviarBorradorAMeta,
  type BorradorGuardado,
} from '@/lib/templates/enviar-borrador';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * El tablero de mensajes: todo lo que el comercio le manda a un cliente,
 * situación por situación, para revisarlo con el dueño de la marca en una
 * reunión y dejar escritos los mensajes que quiere.
 *
 * Cada columna es un pedido de mentira pasado por el MISMO simulador de
 * "Probar como cliente" (`lib/automations/simulacion`): las plantillas ya
 * rellenas, las esperas, las condiciones y a qué asistente pasa la
 * conversación. La compra pagada se simula con cada oferta (la recompra
 * cambia con las unidades) pero se muestra en una sola columna.
 *
 * GET   /api/automations/tablero → { comercio, columnas, plantillas }
 * PATCH /api/automations/tablero   { plantilla_id, body_text } → { plantilla } | { cambio }
 *   Un borrador se edita directo; una que ya está en Meta queda como cambio
 *   pedido para que el equipo de Riverz lo apruebe.
 * POST  /api/automations/tablero → manda los borradores a aprobación de Meta.
 * DELETE /api/automations/tablero → borra de Riverz y de Meta las que ya no usa nada.
 */

interface Columna {
  id: string;
  escenario: EscenarioSimulado;
  pago: PedidoDePrueba['pago'] | null;
  /** La oferta de la compra, cuando la columna es una por oferta. */
  oferta: string | null;
  automatizaciones: AutomacionSimulada[];
  /** Compra pagada: el mismo camino con cada oferta, para elegirla en la columna. */
  ofertas?: Array<{ oferta: string; automatizaciones: AutomacionSimulada[] }>;
}

async function cuenta() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: translate(locale, 'errAi.unauthorized') }, { status: 401 }) };
  }
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) {
    return { error: NextResponse.json({ error: translate(locale, 'errAi.forbidden') }, { status: 403 }) };
  }
  return { admin, workspaceId, locale, userId: user.id };
}

export async function GET() {
  const c = await cuenta();
  if ('error' in c) return c.error;
  const { admin, workspaceId } = c;

  const [{ data: ws }, { data: producto }, { data: agentes }, currency] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    admin
      .from('shopify_products')
      .select('title, price_min, allowed_offers')
      .eq('workspace_id', workspaceId)
      .is('master_id', null)
      .order('title', { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin.from('ai_agents').select('medios_pago').eq('workspace_id', workspaceId).is('deleted_at', null),
    resolveWorkspaceCurrency(admin, workspaceId),
  ]);

  const fila = producto as { title?: string | null; price_min?: number | string | null; allowed_offers?: unknown } | null;
  const titulo = fila?.title?.trim() || 'Producto de prueba';
  const ofertas = (Array.isArray(fila?.allowed_offers) ? fila.allowed_offers : [])
    .map((o) => o as { units?: unknown; total?: unknown; label?: unknown })
    .filter((o) => Number.isSafeInteger(Number(o.units)) && Number(o.units) > 0 && Number.isFinite(Number(o.total)))
    .sort((a, b) => Number(a.units) - Number(b.units));
  // Las demás situaciones usan la primera oferta: en vivo el pedido siempre
  // trae la suya, y sin ella el mensaje mostraba el título largo del producto.
  const primera = ofertas[0];
  const base = {
    title: titulo,
    price: primera ? String(Number(primera.total)) : fila?.price_min != null ? String(fila.price_min) : '110000',
    variant_title: null,
    quantity: primera ? Number(primera.units) : 1,
    oferta: primera && typeof primera.label === 'string' && primera.label.trim() ? primera.label.trim() : null,
  };
  const medios = new Set(
    ((agentes ?? []) as Array<{ medios_pago?: unknown }>).flatMap((a) =>
      Array.isArray(a.medios_pago) ? a.medios_pago.filter((m): m is string => typeof m === 'string') : []
    )
  );
  const acepta = medios.has('contraentrega');
  const cliente = { nombre: CLIENTE_DE_PRUEBA, telefono: lugarDePrueba(currency).telefono };

  const pedidos: Array<Omit<Columna, 'automatizaciones'> & { pedido: PedidoDePrueba }> = [
    ...(ofertas.length ? ofertas : [null]).map((o) => ({
      id: `pagado-${o ? Number(o.units) : 1}`,
      escenario: 'shopify_order_created' as const,
      pago: 'tarjeta' as const,
      oferta: o ? (typeof o.label === 'string' && o.label.trim() ? o.label.trim() : `× ${Number(o.units)}`) : null,
      pedido: {
        producto: o
          ? {
              ...base,
              price: String(Number(o.total)),
              quantity: Number(o.units),
              oferta: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : null,
            }
          : base,
        currency,
        pago: 'tarjeta' as const,
        cliente,
      },
    })),
    ...(acepta
      ? [{ id: 'contraentrega', escenario: 'shopify_order_created' as const, pago: 'cod' as const, oferta: null, pedido: { producto: base, currency, pago: 'cod' as const, cliente } }]
      : []),
    // Sin columna aparte para la transferencia: en la tienda entra como un
    // pedido pendiente y recibe exactamente lo mismo que "Pago pendiente".
    { id: 'pendiente', escenario: 'shopify_order_created', pago: 'pendiente', oferta: null, pedido: { producto: base, currency, pago: 'pendiente', cliente } },
    { id: 'carrito', escenario: 'shopify_abandoned_checkout', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente } },
    { id: 'rechazado', escenario: 'payment_rejected', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente } },
    { id: 'despachado', escenario: 'shopify_order_fulfilled', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente, guia: '360003112209570' } },
    ...(ofertas.length ? ofertas : [null]).map((o) => ({
      id: `entregado-${o ? Number(o.units) : 1}`,
      escenario: 'shopify_order_delivered' as const,
      pago: null,
      oferta: o && typeof o.label === 'string' ? o.label : null,
      pedido: {
        producto: o ? { ...base, price: String(Number(o.total)), quantity: Number(o.units),
          oferta: typeof o.label === 'string' ? o.label : null } : base,
        currency, pago: 'tarjeta' as const, cliente,
      },
    })),
    { id: 'cancelado', escenario: 'shopify_order_cancelled', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente } },
  ];

  try {
    const simuladas: Columna[] = await Promise.all(
      pedidos.map(async ({ pedido, ...col }) => {
        const r = await simularDisparo(admin, workspaceId, col.escenario, pedido);
        // En cada situación, sólo lo que le llega al cliente: una automatización
        // que en ese camino no manda nada (el pago pendiente ante una compra ya
        // pagada) no aporta a la reunión y se lee como si fuera a salir.
        return { ...col, automatizaciones: r.automatizaciones.filter(envia) };
      })
    );
    // La compra pagada es UNA situación: lo que cambia con la oferta es el
    // total, el producto y, en la recompra, cuándo se le escribe. Va en una
    // sola columna y la oferta se elige adentro.
    const pagadas = simuladas.filter((c) => c.id.startsWith('pagado-'));
    // Lo que arranca días después de la compra (el seguimiento y la recompra)
    // va en su propia columna, después del despacho: el tablero se lee en el
    // orden en que le pasan las cosas al cliente.
    const agrupar = (id: string, filtro: (a: AutomacionSimulada) => boolean, situaciones = pagadas): Columna[] => {
      if (!situaciones.length) return [];
      const variantes = situaciones.map((c) => ({ oferta: c.oferta ?? '', automatizaciones: c.automatizaciones.filter(filtro) }));
      return [
        {
          ...situaciones[0],
          id,
          oferta: null,
          automatizaciones: variantes[0].automatizaciones,
          ofertas: variantes.length > 1 ? variantes : undefined,
        },
      ];
    };
    const porId = (id: string) => simuladas.filter((c) => c.id === id);
    const columnas: Columna[] = [
      ...porId('carrito'),
      ...porId('rechazado'),
      ...porId('pendiente'),
      ...agrupar('pagado', (a) => !empiezaDiasDespues(a)),
      ...porId('contraentrega'),
      ...porId('despachado'),
      ...agrupar('recompra', empiezaDiasDespues),
      ...agrupar('entregado', () => true, simuladas.filter((c) => c.id.startsWith('entregado-'))),
      ...porId('cancelado'),
      // Una situación en la que no sale nada no aporta a la reunión.
    ].filter((c) => c.automatizaciones.length > 0 || (c.ofertas ?? []).some((o) => o.automatizaciones.length > 0));
    const todas = await plantillasDeLasAutomatizaciones(admin, workspaceId);
    return NextResponse.json(
      {
        comercio: (ws as { name?: string | null } | null)?.name ?? null,
        producto: titulo,
        columnas,
        plantillas: Object.fromEntries(todas.map((p) => [p.name, p])),
        // Las mismas que manda "Enviar a Meta": todas las que usan las
        // automatizaciones, no sólo las que aparecen con este pedido de ejemplo.
        borradores: todas.filter((p) => EDITABLES.has(String(p.status ?? '').toLowerCase())).length,
        sin_uso: (await plantillasSinUso(admin, workspaceId)).length,
        // Los cambios que esperan al equipo, por nombre de plantilla.
        cambios: Object.fromEntries(
          (
            ((
              await admin
                .from('cambios_de_plantilla')
                .select('plantilla_nombre, despues')
                .eq('workspace_id', workspaceId)
                .eq('estado', 'pendiente')
            ).data ?? []) as Array<{ plantilla_nombre: string; despues: string }>
          ).map((c) => [c.plantilla_nombre, c.despues])
        ),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return serverError(err, translate(await getLocale(), 'automations.simulationUnavailable'));
  }
}

/**
 * Las plantillas que ya no usa nada: ninguna automatización activa o armada,
 * ninguna campaña. Son las que quedan cuando se reescribe una con otro nombre.
 */
async function plantillasSinUso(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string
): Promise<Array<{ id: string; name: string; status: string | null; meta_template_id: string | null }>> {
  const [{ data: todas }, enUso, { data: campanas }, { data: alerta }] = await Promise.all([
    admin.from('message_templates').select('id, name, status, meta_template_id').eq('workspace_id', workspaceId),
    plantillasDeLasAutomatizaciones(admin, workspaceId),
    admin.from('broadcasts').select('template_name').eq('workspace_id', workspaceId),
    admin.from('platform_whatsapp_settings').select('alert_template_name'),
  ]);
  const usadas = new Set<string>([
    ...enUso.map((p) => p.name),
    ...((campanas ?? []) as Array<{ template_name: string | null }>).map((c) => c.template_name ?? ''),
    ...((alerta ?? []) as Array<{ alert_template_name: string | null }>).map((a) => a.alert_template_name ?? ''),
  ]);
  return ((todas ?? []) as Array<{ id: string; name: string; status: string | null; meta_template_id: string | null }>).filter(
    (p) => !usadas.has(p.name)
  );
}

/**
 * DELETE /api/automations/tablero → { borradas, fallidas }
 *
 * Borra de Riverz y de Meta las plantillas que ya no usa nada.
 */
export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuenta();
  if ('error' in c) return c.error;
  const { admin, workspaceId, userId } = c;
  const borradas: string[] = [];
  const fallidas: Array<{ nombre: string; motivo: string }> = [];
  for (const plantilla of await plantillasSinUso(admin, workspaceId)) {
    const r = await borrarPlantilla(admin, { workspaceId, userId, plantilla });
    if (r.ok) borradas.push(plantilla.name);
    else fallidas.push({ nombre: plantilla.name, motivo: r.detalle || r.motivo });
  }
  return NextResponse.json({ borradas, fallidas });
}

/** Lo que Meta todavía no revisó se puede reescribir; lo demás, no desde acá. */
const EDITABLES = new Set(['draft', 'rejected']);

/** ¿Su primer mensaje sale días después del disparo? (seguimiento, recompra) */
function empiezaDiasDespues(a: AutomacionSimulada): boolean {
  for (const p of a.pasos) {
    if (p.tipo === 'espera') return p.unit === 'days' || p.unit === 'weeks' || p.unit === 'months';
    if (p.tipo === 'plantilla' || p.tipo === 'mensaje' || p.tipo === 'llamada') return false;
  }
  return false;
}

/** ¿Le llega algo al cliente por este camino? */
function envia(a: AutomacionSimulada): boolean {
  return !a.omitida && a.pasos.some((p) => p.tipo === 'plantilla' || p.tipo === 'mensaje' || p.tipo === 'llamada');
}

/** Todas las plantillas que usan las automatizaciones del comercio. */
async function plantillasDeLasAutomatizaciones(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string
): Promise<Array<BorradorGuardado & { status: string | null }>> {
  const { data: autos } = await admin
    .from('automations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null);
  const ids = ((autos ?? []) as Array<{ id: string }>).map((a) => a.id);
  if (ids.length === 0) return [];
  const { data: pasos } = await admin
    .from('automation_steps')
    .select('step_config')
    .in('automation_id', ids)
    .eq('step_type', 'send_template');
  const nombres = [
    ...new Set(
      ((pasos ?? []) as Array<{ step_config: { template_name?: unknown } | null }>)
        .map((p) => p.step_config?.template_name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
    ),
  ];
  if (nombres.length === 0) return [];
  const { data } = await admin
    .from('message_templates')
    .select(COLUMNAS_DE_BORRADOR)
    .eq('workspace_id', workspaceId)
    .in('name', nombres);
  return (data ?? []) as Array<BorradorGuardado & { status: string | null }>;
}

/**
 * POST /api/automations/tablero → { enviadas, fallidas }
 *
 * Manda a aprobación de Meta los borradores (y los rechazados) que usan las
 * automatizaciones del comercio: lo revisado en el tablero sale de una vez.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuenta();
  if ('error' in c) return c.error;
  const { admin, workspaceId, locale, userId } = c;

  const filas = await plantillasDeLasAutomatizaciones(admin, workspaceId);
  const enviadas: string[] = [];
  const fallidas: Array<{ nombre: string; motivo: string }> = [];
  for (const fila of filas) {
    if (!EDITABLES.has(String(fila.status ?? '').toLowerCase())) continue;
    const r = await enviarBorradorAMeta(admin, { workspaceId, userId, fila });
    if (r.ok) enviadas.push(r.name);
    else {
      fallidas.push({
        nombre: fila.name,
        motivo: r.mensaje ?? translate(locale, `errWhatsapp.${r.claveI18n ?? 'metaRejectedTemplate'}`, r.params),
      });
    }
  }
  return NextResponse.json({ enviadas, fallidas });
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuenta();
  if ('error' in c) return c.error;
  const { admin, workspaceId, locale, userId } = c;
  const body = (await request.json().catch(() => null)) as { plantilla_id?: unknown; body_text?: unknown } | null;
  const id = typeof body?.plantilla_id === 'string' ? body.plantilla_id : '';
  const texto = typeof body?.body_text === 'string' ? body.body_text.replace(/\r\n/g, '\n').trim() : '';
  if (!id || !texto) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { data: actual, error } = await admin
    .from('message_templates')
    .select('id, name, status, body_text')
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error);
  if (!actual) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const fila = actual as { id: string; name: string; status: string | null; body_text: string | null };
  const problema = problemaDelTexto(texto, fila.body_text ?? '');
  if (problema) {
    return NextResponse.json({ error: translate(locale, `automations.${problema}`) }, { status: 400 });
  }
  // Ya está en Meta: no se toca. Queda como cambio pedido, que el equipo de
  // Riverz aprueba en el panel de plataforma (`lib/templates/cambios`).
  if (!EDITABLES.has(String(fila.status ?? '').toLowerCase())) {
    try {
      const cambio = await pedirCambio(admin, { workspaceId, userId, plantilla: fila, despues: texto });
      return NextResponse.json({ cambio });
    } catch (err) {
      return serverError(err);
    }
  }
  const { data, error: errGuardar } = await admin
    .from('message_templates')
    .update({ body_text: texto, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select('id, name, status, category, body_text, variable_fields')
    .single();
  if (errGuardar) return serverError(errGuardar);
  return NextResponse.json({ plantilla: data });
}
