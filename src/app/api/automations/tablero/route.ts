import { NextResponse } from 'next/server';
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
 * conversación. Una compra pagada va una vez por oferta, porque la recompra
 * cambia con las unidades.
 *
 * GET   /api/automations/tablero → { comercio, columnas, plantillas }
 * PATCH /api/automations/tablero   { plantilla_id, body_text } → { plantilla }
 *   Edita el texto de una plantilla que todavía no se mandó a Meta.
 */

interface Columna {
  id: string;
  escenario: EscenarioSimulado;
  pago: PedidoDePrueba['pago'] | null;
  /** La oferta de la compra, cuando la columna es una por oferta. */
  oferta: string | null;
  automatizaciones: AutomacionSimulada[];
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
  return { admin, workspaceId, locale };
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
      .order('created_at', { ascending: true })
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
  const base = {
    title: titulo,
    price: fila?.price_min != null ? String(fila.price_min) : '110000',
    variant_title: null,
    quantity: 1,
  };
  const medios = new Set(
    ((agentes ?? []) as Array<{ medios_pago?: unknown }>).flatMap((a) =>
      Array.isArray(a.medios_pago) ? a.medios_pago.filter((m): m is string => typeof m === 'string') : []
    )
  );
  const acepta = medios.has('contraentrega');
  const cliente = { nombre: 'Ana Prueba', telefono: lugarDePrueba(currency).telefono };

  const pedidos: Array<Omit<Columna, 'automatizaciones'> & { pedido: PedidoDePrueba }> = [
    ...(ofertas.length ? ofertas : [null]).map((o) => ({
      id: `pagado-${o ? Number(o.units) : 1}`,
      escenario: 'shopify_order_created' as const,
      pago: 'tarjeta' as const,
      oferta: o ? (typeof o.label === 'string' && o.label.trim() ? o.label.trim() : `× ${Number(o.units)}`) : null,
      pedido: {
        producto: o ? { ...base, price: String(Number(o.total)), quantity: Number(o.units) } : base,
        currency,
        pago: 'tarjeta' as const,
        cliente,
      },
    })),
    ...(acepta
      ? [{ id: 'contraentrega', escenario: 'shopify_order_created' as const, pago: 'cod' as const, oferta: null, pedido: { producto: base, currency, pago: 'cod' as const, cliente } }]
      : []),
    ...(medios.has('transferencia')
      ? [{ id: 'transferencia', escenario: 'shopify_order_created' as const, pago: 'transferencia' as const, oferta: null, pedido: { producto: base, currency, pago: 'transferencia' as const, cliente } }]
      : []),
    { id: 'pendiente', escenario: 'shopify_order_created', pago: 'pendiente', oferta: null, pedido: { producto: base, currency, pago: 'pendiente', cliente } },
    { id: 'carrito', escenario: 'shopify_abandoned_checkout', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente } },
    { id: 'rechazado', escenario: 'payment_rejected', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente } },
    { id: 'despachado', escenario: 'shopify_order_fulfilled', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente, guia: '360003112209570' } },
    { id: 'entregado', escenario: 'shopify_order_delivered', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente } },
    { id: 'cancelado', escenario: 'shopify_order_cancelled', pago: null, oferta: null, pedido: { producto: base, currency, pago: 'tarjeta', cliente } },
  ];

  try {
    const columnas: Columna[] = await Promise.all(
      pedidos.map(async ({ pedido, ...col }) => {
        const r = await simularDisparo(admin, workspaceId, col.escenario, pedido);
        return { ...col, automatizaciones: r.automatizaciones };
      })
    );
    const nombres = new Set<string>();
    for (const col of columnas) {
      for (const a of col.automatizaciones) {
        for (const p of a.pasos) if (p.tipo === 'plantilla') nombres.add(p.nombre);
      }
    }
    const { data: plantillas } = nombres.size
      ? await admin
          .from('message_templates')
          .select('id, name, status, category, body_text, variable_fields')
          .eq('workspace_id', workspaceId)
          .in('name', [...nombres])
      : { data: [] };
    return NextResponse.json(
      {
        comercio: (ws as { name?: string | null } | null)?.name ?? null,
        producto: titulo,
        columnas,
        plantillas: Object.fromEntries(((plantillas ?? []) as Array<{ name: string }>).map((p) => [p.name, p])),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return serverError(err);
  }
}

/** Lo que Meta todavía no revisó se puede reescribir; lo demás, no desde acá. */
const EDITABLES = new Set(['draft', 'rejected']);

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuenta();
  if ('error' in c) return c.error;
  const { admin, workspaceId, locale } = c;
  const body = (await request.json().catch(() => null)) as { plantilla_id?: unknown; body_text?: unknown } | null;
  const id = typeof body?.plantilla_id === 'string' ? body.plantilla_id : '';
  const texto = typeof body?.body_text === 'string' ? body.body_text.replace(/\r\n/g, '\n').trim() : '';
  if (!id || !texto) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { data: actual, error } = await admin
    .from('message_templates')
    .select('id, status, body_text')
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error);
  if (!actual) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const fila = actual as { status: string | null; body_text: string | null };
  if (!EDITABLES.has(String(fila.status ?? '').toLowerCase())) {
    return NextResponse.json({ error: translate(locale, 'automations.tableroNoEditable') }, { status: 409 });
  }
  const problema = problemaDelTexto(texto, fila.body_text ?? '');
  if (problema) {
    return NextResponse.json({ error: translate(locale, `automations.${problema}`) }, { status: 400 });
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
