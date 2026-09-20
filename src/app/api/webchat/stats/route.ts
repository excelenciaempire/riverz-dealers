import { readOutcomes } from '@/lib/dashboard/outcomes-query';
import { summarizeCases } from '@/lib/dashboard/outcomes';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

// Chat web uses the same verified resolution evidence as the main dashboard.

const WINDOW_DAYS = 30;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId)
    return NextResponse.json({ error: 'no_workspace' }, { status: 404 });

  const ventana = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - ventana).toISOString();
  // El período anterior, del mismo largo. Un número solo no dice si el canal
  // está mejorando o empeorando, que es lo único que se hace con estas cifras.
  const sinceAnterior = new Date(Date.now() - ventana * 2).toISOString();

  const [conversationsRes, ordersRes, previasRes] = await Promise.all([
    admin
      .from('conversations')
      .select('id, status, assigned_agent_id, needs_human_at, csat, created_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'webchat')
      .is('deleted_at', null)
      .gte('created_at', since),
    admin
      .from('orders')
      .select('total_price, currency, status')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'webchat')
      .gte('created_at', since),
    admin
      .from('conversations')
      .select('id, assigned_agent_id, needs_human_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'webchat')
      .is('deleted_at', null)
      .gte('created_at', sinceAnterior)
      .lt('created_at', since),
  ]);

  const conversations = (conversationsRes.data ?? []) as Array<{
    id: string;
    status: string | null;
    assigned_agent_id: string | null;
    needs_human_at: string | null;
    csat: number | null;
    created_at: string;
  }>;
  const orders = (ordersRes.data ?? []) as Array<{
    total_price: number | string | null;
    currency: string | null;
    status: string | null;
  }>;

  const escalated = conversations.filter(
    (c) => Boolean(c.needs_human_at) || Boolean(c.assigned_agent_id)
  ).length;

  // Un pedido cancelado o que nunca se pudo crear no es ingreso: contarlo
  // infla justo el número que el comercio va a usar para decidir si el canal
  // vale la pena. (`orders.status` sólo admite created|paid|fulfilled|
  // cancelled|failed — no hay 'refunded' que filtrar.)
  //
  // Y se agrupa por divisa. Antes se sumaba todo junto y al total se le pegaba
  // la divisa del primer pedido de la lista: una tienda que vende en pesos y
  // en dólares veía 1.250.000 "USD", un número que no existe.
  const porDivisa = new Map<string, { revenue: number; orders: number }>();
  for (const o of orders) {
    if (o.status === 'cancelled' || o.status === 'failed') continue;
    const n =
      typeof o.total_price === 'number'
        ? o.total_price
        : parseFloat(String(o.total_price ?? ''));
    if (!Number.isFinite(n)) continue;
    const code = (o.currency ?? '').trim().toUpperCase();
    const acc = porDivisa.get(code) ?? { revenue: 0, orders: 0 };
    acc.revenue += n;
    acc.orders += 1;
    porDivisa.set(code, acc);
  }
  const revenueByCurrency = [...porDivisa.entries()]
    .map(([currency, v]) => ({ currency: currency || null, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  // Satisfacción: sobre las que CALIFICARON, no sobre el total. Dividir por
  // todas convertiría "poca gente votó" en "a poca gente le sirvió", que son
  // dos problemas distintos y se arreglan de forma distinta.
  const calificaron = conversations.filter(
    (c) => c.csat === 1 || c.csat === -1
  );
  const conformes = calificaron.filter((c) => c.csat === 1).length;

  // Cuánto tardó en llegar la primera respuesta. Se mide sobre el hilo, no
  // sobre lo que declare el agente: lo que importa es cuánto esperó la persona.
  const tiempos = await primerasRespuestas(
    admin,
    conversations.slice(0, 300).map((c) => c.id)
  );
  const mediana =
    tiempos.length > 0
      ? tiempos.sort((a, b) => a - b)[Math.floor(tiempos.length / 2)]
      : null;

  const previas = (previasRes.data ?? []) as Array<{
    assigned_agent_id: string | null;
    needs_human_at: string | null;
  }>;
  const outcomes = await readOutcomes(admin, workspaceId, {
    start: since,
    end: new Date().toISOString(),
  });
  const verified = summarizeCases(
    outcomes.cases.filter((c) => c.channel === 'webchat')
  );

  // `revenue` + `currency` siguen siendo la divisa que más movió, no la mezcla:
  // la tarjeta de Ajustes muestra ese par y con una sola divisa —el caso
  // normal— da exactamente lo mismo que antes.
  const principal = revenueByCurrency[0] ?? null;

  return NextResponse.json({
    period_days: WINDOW_DAYS,
    conversations: conversations.length,
    resolved: verified.verified,
    escalated,
    orders: orders.length,
    revenue: principal?.revenue ?? 0,
    currency: principal?.currency ?? null,
    revenue_by_currency: revenueByCurrency,
    // Qué tan seguido el agente cerró el caso solo, y contra el período
    // anterior.
    resolution_rate:
      verified.rate === null ? null : Math.round(verified.rate * 100),
    resolution_rate_previous: null,
    conversations_previous: previas.length,
    // Cuánta gente calificó y a cuánta le sirvió.
    rated: calificaron.length,
    satisfaction_rate:
      calificaron.length > 0
        ? Math.round((conformes / calificaron.length) * 100)
        : null,
    // Segundos hasta la primera respuesta, mediana. La mediana y no el
    // promedio: una sola conversación que quedó abierta un fin de semana
    // arrastra el promedio y esconde que el resto contesta en segundos.
    first_response_seconds: mediana,
  });
}

/**
 * Cuánto esperó cada persona su primera respuesta.
 *
 * Se lee del hilo y no de un contador guardado: la respuesta puede llegar del
 * agente o de alguien del equipo, y lo que se está midiendo es la espera, no
 * quién la cortó.
 */
async function primerasRespuestas(
  admin: ReturnType<typeof supabaseAdmin>,
  conversationIds: string[]
): Promise<number[]> {
  if (conversationIds.length === 0) return [];
  const { data } = await admin
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: true })
    .limit(4000);

  const filas = (data ?? []) as Array<{
    conversation_id: string;
    sender_type: string;
    created_at: string;
  }>;
  const primerCliente = new Map<string, number>();
  const espera: number[] = [];
  for (const m of filas) {
    const t = Date.parse(m.created_at);
    if (!Number.isFinite(t)) continue;
    if (m.sender_type === 'customer') {
      if (!primerCliente.has(m.conversation_id))
        primerCliente.set(m.conversation_id, t);
      continue;
    }
    const desde = primerCliente.get(m.conversation_id);
    // `delete` para contar UNA sola vez por conversación: sin esto, cada
    // mensaje posterior del comercio volvía a sumar la misma espera.
    if (desde !== undefined) {
      espera.push(Math.max(0, Math.round((t - desde) / 1000)));
      primerCliente.delete(m.conversation_id);
    }
  }
  return espera;
}
