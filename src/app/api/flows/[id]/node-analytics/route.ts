import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serverError } from '@/lib/api/errors';

/**
 * GET /api/flows/[id]/node-analytics?days=7
 *
 * Devuelve, por cada node_key del flujo, cuántas veces los clientes
 * pasaron por ese nodo en los últimos `days` días. Sirve para que el
 * editor pinte una capa de heatmap encima de cada card.
 *
 * Por simplicidad usamos flow_run_events con event_type='node_entered'
 * como fuente de verdad — el engine ya emite esos eventos.
 */

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '7')));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Obtenemos los flow_run_ids del flow primero (RLS ya scopea), después
  // contamos node_entered por node_key. PostgREST no soporta group_by
  // arbitrario en el cliente, así que pegamos un SELECT directo.
  const { data: runs, error: rErr } = await supabase
    .from('flow_runs')
    .select('id')
    .eq('flow_id', id)
    .gte('started_at', since);
  if (rErr) {
    return serverError(rErr);
  }
  const runIds = (runs ?? []).map((r: { id: string }) => r.id);
  if (runIds.length === 0) {
    return NextResponse.json({ days, by_node: {} });
  }

  const { data: events, error: eErr } = await supabase
    .from('flow_run_events')
    .select('node_key, event_type')
    .in('flow_run_id', runIds)
    .eq('event_type', 'node_entered')
    .not('node_key', 'is', null);
  if (eErr) {
    return serverError(eErr);
  }

  // Agregamos en el server: por cada node_key, cantidad de entries.
  const by_node: Record<string, number> = {};
  for (const ev of events ?? []) {
    const k = (ev as { node_key: string }).node_key;
    by_node[k] = (by_node[k] ?? 0) + 1;
  }
  return NextResponse.json({
    days,
    by_node,
    total_runs: runIds.length,
  });
}
