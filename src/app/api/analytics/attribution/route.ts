import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { fetchRecentOrdersOtherPlatform } from '@/lib/commerce/recent-orders';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import {
  fetchRecentOrders,
  getActiveShopifyConnection,
  normPhone,
} from '@/lib/attribution/shopify';

/**
 * GET /api/analytics/attribution?days=30
 *
 * Atribuye revenue de Shopify a las entidades del workspace en los últimos
 * `days` días, en cuatro lentes independientes:
 *
 *   - by_broadcast        — última campaña enviada al contacto 24h antes de la orden
 *   - by_flow             — último flow_run del contacto 24h antes de la orden
 *   - by_automation       — último automation_log (success/partial) 24h antes
 *   - by_instagram_agent  — revenue ya atribuido por el Agente de IG a sus
 *                           destinatarios (determinista + incrementalidad),
 *                           dentro de la ventana de `days`.
 *
 * Son lentes SEPARADAS, no una partición: una misma orden puede contar para
 * varias (p. ej. el contacto recibió una campaña Y pasó por un flujo). Por eso
 * NO sumamos un total combinado — eso duplicaría órdenes.
 *
 * Output:
 *   { days, by_broadcast, by_flow, by_automation, by_instagram_agent }
 *   donde cada bucket es [{ id, name, orders_count, revenue, currency }]
 *
 * Limit por simplicidad: las lentes by_broadcast/by_flow/by_automation solo
 * cuentan órdenes con `email`/`phone` que matchea un contacto del workspace.
 */

interface AttrRow {
  id: string;
  name: string;
  orders_count: number;
  revenue: number;
  currency: string;
}

/** Totales de comercio (todas las órdenes del rango, no solo las atribuidas). */
interface CommerceTotals {
  revenue: { current: number; previous: number };
  orders: { current: number; previous: number };
  currency: string;
}

/**
 * Lo que pasó por Riverz, contado UNA vez.
 *
 * Las cuatro lentes de abajo se pisan: un pedido cuya persona recibió la
 * campaña Y pasó por la automatización aparece en las dos. Para responder "¿qué
 * me devolvió Riverz?" hace falta un número solo, así que acá se cuenta el
 * PEDIDO —no la lente— y un pedido tocado por tres cosas suma una vez.
 *
 * Deja afuera al Agente de IG: ese lente no viene de estos pedidos sino del
 * revenue que su propio motor ya atribuyó por destinatario, sin id de pedido
 * con qué deduplicar. Sumarlo daría un número más alto y posiblemente repetido;
 * se sigue viendo aparte en el detalle.
 */
interface Attributed {
  revenue: number;
  orders: number;
  currency: string;
}

const EMPTY_TOTALS: CommerceTotals = {
  revenue: { current: 0, previous: 0 },
  orders: { current: 0, previous: 0 },
  currency: 'USD',
};

function emptyResponse(days: number) {
  return {
    days,
    by_broadcast: [] as AttrRow[],
    by_flow: [] as AttrRow[],
    by_automation: [] as AttrRow[],
    by_instagram_agent: [] as AttrRow[],
    totals: EMPTY_TOTALS,
    attributed: { revenue: 0, orders: 0, currency: 'USD' } as Attributed,
  };
}

export async function GET(request: Request) {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  // Date-range filter: prefer explicit ISO start/end (from the dashboard's
  // global filter); fall back to the legacy ?days= window. `until` lets a
  // custom/past range exclude orders after the picked end day.
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  let sinceIso: string;
  let untilIso: string;
  let days: number;
  if (
    startParam &&
    endParam &&
    !Number.isNaN(Date.parse(startParam)) &&
    !Number.isNaN(Date.parse(endParam))
  ) {
    sinceIso = new Date(startParam).toISOString();
    untilIso = new Date(endParam).toISOString();
    // Defensive: never let an inverted range silently return zero orders.
    if (Date.parse(sinceIso) > Date.parse(untilIso)) {
      [sinceIso, untilIso] = [untilIso, sinceIso];
    }
    days = Math.max(1, Math.round((Date.parse(untilIso) - Date.parse(sinceIso)) / 86_400_000));
  } else {
    days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '30')));
    sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    untilIso = new Date().toISOString();
  }

  // Ventana de last-touch: cuántas horas antes del pedido cuenta un envío
  // como el que lo causó. 24h es el default histórico y sirve para una
  // campaña o un carrito abandonado, donde la compra cae el mismo día.
  // Una recuperación de pago rechazado no: la persona tiene que hablar con
  // el banco o esperar a que le entre plata, y vuelve a los dos o tres
  // días. Con 24h fijas esas ventas quedaban sin atribuir. Es un parámetro
  // y no un cambio de default para no inflar de golpe los números
  // históricos de campañas y flujos.
  const attrHours = Math.max(
    1,
    Math.min(720, Number(url.searchParams.get('attr_hours') ?? '24')),
  );
  const lookbackMs = attrHours * 3_600_000;

  const admin = supabaseAdmin();

  // Resolver el workspace del caller EXACTAMENTE como lo resuelve el resto de
  // la app (instalación, productos, status): owner-first vía
  // resolveWorkspaceIdForUser. Antes este endpoint usaba `workspace_members`
  // ordenado por joined_at, que difería del id bajo el que se guarda la
  // conexión de Shopify — y reportaba "no conectado" en un shop conectado.
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) {
    return NextResponse.json(emptyResponse(days));
  }

  // Conexión Shopify del workspace (token descifrado). null = sin conexión
  // activa o token indescifrable → la UI muestra el estado "Conectar Shopify".
  const conn = await getActiveShopifyConnection(admin, workspaceId);
  // Sin Shopify, el comercio puede tener Tiendanube o WooCommerce. Antes esta
  // pantalla contestaba "conectá Shopify" a alguien que SÍ tenía su tienda
  // conectada, y sus ventas no aparecían en ninguna métrica.
  const otraTienda = conn
    ? null
    : await fetchRecentOrdersOtherPlatform(admin, workspaceId, sinceIso).catch(
        () => null,
      );
  if (!conn && !otraTienda) {
    return NextResponse.json({ ...emptyResponse(days), not_connected: true });
  }

  // Órdenes recientes desde Shopify (fetch desde `since`), recortadas a la
  // ventana [since, until) — `until` solo limita en rangos personalizados/pasados.
  const sinceMs = Date.parse(sinceIso);
  const untilMs = Date.parse(untilIso);
  // Ventana previa de igual duración, para los deltas de los totales de comercio.
  const prevSinceIso = new Date(sinceMs - (untilMs - sinceMs)).toISOString();
  const prevSinceMs = Date.parse(prevSinceIso);
  let orders;
  let prevOrders;
  try {
    // Un solo fetch desde el inicio de la ventana previa; luego separamos en
    // actual [since,until) y previa [prevSince,since).
    const all = conn
      ? await fetchRecentOrders(conn, prevSinceIso)
      : ((
          await fetchRecentOrdersOtherPlatform(admin, workspaceId, prevSinceIso)
        )?.orders ?? []);
    orders = all.filter((o) => {
      const t = Date.parse(o.created_at);
      return t >= sinceMs && t < untilMs;
    });
    prevOrders = all.filter((o) => {
      const t = Date.parse(o.created_at);
      return t >= prevSinceMs && t < sinceMs;
    });
  } catch {
    return NextResponse.json({
      ...emptyResponse(days),
      error: 'shopify_fetch_failed',
    });
  }

  // Totales de comercio: TODAS las órdenes del rango (no solo las atribuidas),
  // con su periodo previo para el delta. AOV se calcula en el cliente.
  const sumRevenue = (arr: typeof orders) =>
    Math.round(arr.reduce((s, o) => s + Number(o.total_price ?? '0'), 0) * 100) / 100;
  const totals: CommerceTotals = {
    revenue: { current: sumRevenue(orders), previous: sumRevenue(prevOrders) },
    orders: { current: orders.length, previous: prevOrders.length },
    currency: orders[0]?.currency || prevOrders[0]?.currency || 'USD',
  };

  // Agente de IG: revenue ya persistido por su motor (no depende del fetch de
  // arriba, pero solo lo mostramos en el camino feliz para no contradecir el
  // estado "conectado").
  const by_instagram_agent = await attributeInstagramAgent(
    admin,
    workspaceId,
    sinceIso,
    untilIso,
    locale,
  );

  // Match cada orden con un contact (por email o phone).
  const emails = Array.from(
    new Set(orders.map((o) => o.email).filter((x): x is string => !!x)),
  );
  const phones = Array.from(
    new Set(orders.map((o) => normPhone(o.phone)).filter((x): x is string => !!x)),
  );
  const { data: contactsByEmail } = await admin
    .from('contacts')
    .select('id, email, phone')
    .eq('workspace_id', workspaceId)
    .in('email', emails.length > 0 ? emails : ['__none__']);
  const { data: contactsByPhone } = await admin
    .from('contacts')
    .select('id, email, phone')
    .eq('workspace_id', workspaceId)
    .in('phone', phones.length > 0 ? phones : ['__none__']);

  const emailToContact = new Map<string, string>();
  for (const c of contactsByEmail ?? []) {
    const row = c as { id: string; email?: string };
    if (row.email) emailToContact.set(row.email.toLowerCase(), row.id);
  }
  const phoneToContact = new Map<string, string>();
  for (const c of contactsByPhone ?? []) {
    const row = c as { id: string; phone?: string };
    if (row.phone) phoneToContact.set(normPhone(row.phone) ?? '', row.id);
  }

  // Por cada orden buscamos su contacto y atribuimos a la última campaña,
  // flujo y automatización que lo tocaron en las 24h previas (last-touch).
  const byBroadcast = new Map<string, AttrRow>();
  const byFlow = new Map<string, AttrRow>();
  const byAutomation = new Map<string, AttrRow>();
  const attributed: Attributed = { revenue: 0, orders: 0, currency: totals.currency };

  for (const order of orders) {
    const cId =
      (order.email && emailToContact.get(order.email.toLowerCase())) ||
      (order.phone && phoneToContact.get(normPhone(order.phone) ?? '')) ||
      null;
    if (!cId) continue;

    const orderTime = new Date(order.created_at).getTime();
    const lookback = new Date(orderTime - lookbackMs).toISOString();
    const total = Number(order.total_price ?? '0');
    const currency = order.currency || 'USD';
    // Este pedido, ¿lo tocó algo de Riverz? Basta con una lente para contarlo,
    // y tres no lo cuentan tres veces.
    let tocado = false;

    // Last broadcast send to this contact in the lookback window.
    const { data: bcRow } = await admin
      .from('broadcast_recipients')
      .select('broadcast_id, broadcasts(name)')
      .eq('contact_id', cId)
      .gte('sent_at', lookback)
      .lte('sent_at', order.created_at)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bcRow) {
      const row = bcRow as { broadcast_id: string; broadcasts: { name?: string } | { name?: string }[] };
      const join = Array.isArray(row.broadcasts) ? row.broadcasts[0] : row.broadcasts;
      accumulate(
        byBroadcast,
        row.broadcast_id,
        join?.name ?? translate(locale, 'errInbox.broadcastFallback'),
        total,
        currency,
      );
      tocado = true;
    }

    // Last flow run for this contact in the lookback window.
    const { data: frRow } = await admin
      .from('flow_runs')
      .select('flow_id, flows(name)')
      .eq('contact_id', cId)
      .eq('workspace_id', workspaceId)
      .gte('started_at', lookback)
      .lte('started_at', order.created_at)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (frRow) {
      const row = frRow as { flow_id: string; flows: { name?: string } | { name?: string }[] };
      const join = Array.isArray(row.flows) ? row.flows[0] : row.flows;
      accumulate(
        byFlow,
        row.flow_id,
        join?.name ?? translate(locale, 'errInbox.flowFallback'),
        total,
        currency,
      );
      tocado = true;
    }

    // Last successful/partial automation run for this contact in the window.
    const { data: autoRow } = await admin
      .from('automation_logs')
      .select('automation_id, automations(name)')
      .eq('contact_id', cId)
      .eq('workspace_id', workspaceId)
      .in('status', ['success', 'partial'])
      .gte('created_at', lookback)
      .lte('created_at', order.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (autoRow) {
      const row = autoRow as { automation_id: string; automations: { name?: string } | { name?: string }[] };
      const join = Array.isArray(row.automations) ? row.automations[0] : row.automations;
      accumulate(
        byAutomation,
        row.automation_id,
        join?.name ?? translate(locale, 'errInbox.automationFallback'),
        total,
        currency,
      );
      tocado = true;
    }

    if (tocado) {
      attributed.orders += 1;
      attributed.revenue += total;
      attributed.currency = currency;
    }
  }

  attributed.revenue = Math.round(attributed.revenue * 100) / 100;

  return NextResponse.json({
    days,
    by_broadcast: sortByRevenue(byBroadcast),
    by_flow: sortByRevenue(byFlow),
    by_automation: sortByRevenue(byAutomation),
    by_instagram_agent,
    totals,
    attributed,
  });
}

/** Add one order's revenue to the bucket keyed by entity id (last-touch). */
function accumulate(
  bucket: Map<string, AttrRow>,
  id: string,
  name: string,
  total: number,
  currency: string,
): void {
  const cur =
    bucket.get(id) ?? { id, name, orders_count: 0, revenue: 0, currency };
  cur.orders_count += 1;
  cur.revenue += total;
  bucket.set(id, cur);
}

function sortByRevenue(bucket: Map<string, AttrRow>): AttrRow[] {
  return Array.from(bucket.values()).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Revenue del Agente de IG dentro de la ventana. A diferencia de los otros
 * buckets, NO recalcula sobre las órdenes en vivo: lee el revenue que el motor
 * del agente ya atribuyó por destinatario (determinista por código + control).
 *
 * Ojo: ventana por `converted_at` = cuándo el motor RECONOCIÓ la venta (lo
 * estampa con NOW al correr el cron), no `created_at` de la orden. Los otros
 * tres buckets sí usan la fecha de la orden. El desfase está acotado (el motor
 * atribuye dentro de ~7 días del envío), pero por eso este lente mide
 * "reconocido en los últimos N días", no "comprado". `orders_count` aquí cuenta
 * destinatarios convertidos (1 por persona), equivalente a órdenes en la práctica.
 */
async function attributeInstagramAgent(
  admin: SupabaseClient,
  workspaceId: string,
  sinceIso: string,
  untilIso: string,
  locale: Locale,
): Promise<AttrRow[]> {
  const { data } = await admin
    .from('instagram_campaign_recipients')
    .select('revenue, currency, campaign_id, instagram_campaigns!inner(name, workspace_id)')
    .eq('status', 'converted')
    .eq('instagram_campaigns.workspace_id', workspaceId)
    .gte('converted_at', sinceIso)
    .lt('converted_at', untilIso)
    .not('revenue', 'is', null)
    .limit(5000);

  const map = new Map<string, AttrRow>();
  for (const r of data ?? []) {
    const row = r as {
      revenue: number | null;
      currency: string | null;
      campaign_id: string;
      instagram_campaigns: { name?: string } | { name?: string }[] | null;
    };
    const join = Array.isArray(row.instagram_campaigns)
      ? row.instagram_campaigns[0]
      : row.instagram_campaigns;
    const cur =
      map.get(row.campaign_id) ?? {
        id: row.campaign_id,
        name: join?.name ?? translate(locale, 'errInbox.igCampaignFallback'),
        orders_count: 0,
        revenue: 0,
        currency: row.currency || 'USD',
      };
    cur.orders_count += 1;
    cur.revenue += Number(row.revenue ?? 0) || 0;
    if (row.currency) cur.currency = row.currency;
    map.set(row.campaign_id, cur);
  }
  return sortByRevenue(map);
}
