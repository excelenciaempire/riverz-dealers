import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';

async function isMember(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Estadísticas por agente para el panel de agentes:
 *   - Actividad: respuestas enviadas / omitidas / conversaciones (ai_replies).
 *   - Resultados: llamadas y confirmadas (voice_calls).
 *   - Costo/uso: tokens consumidos (ai_replies).
 * Ventana por ?start&end ISO (o ?days, default 30).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: agentRow } = await admin
    .from('ai_agents')
    .select('workspace_id')
    .eq('id', id)
    .maybeSingle();
  const workspaceId = (agentRow as { workspace_id?: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await isMember(user.id, workspaceId)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  let sinceIso: string;
  let untilIso: string;
  if (startParam && endParam && !Number.isNaN(Date.parse(startParam)) && !Number.isNaN(Date.parse(endParam))) {
    sinceIso = new Date(startParam).toISOString();
    untilIso = new Date(endParam).toISOString();
  } else {
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '30')));
    sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    untilIso = new Date().toISOString();
  }

  // Actividad (ai_replies) — conteos exactos con head:true.
  const activitySent = await admin
    .from('ai_replies')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', id)
    .eq('status', 'sent')
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso);
  const activitySkipped = await admin
    .from('ai_replies')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', id)
    .eq('status', 'skipped')
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso);

  // Conversaciones distintas + tokens: se necesitan filas (paginado).
  let conversations = 0;
  let tokens = 0;
  {
    const seen = new Set<string>();
    const page = 1000;
    for (let from = 0; from < 50_000; from += page) {
      const { data } = await admin
        .from('ai_replies')
        .select('conversation_id, prompt_tokens, completion_tokens')
        .eq('agent_id', id)
        .gte('created_at', sinceIso)
        .lt('created_at', untilIso)
        .range(from, from + page - 1);
      const rows = (data ?? []) as {
        conversation_id: string | null;
        prompt_tokens: number | null;
        completion_tokens: number | null;
      }[];
      for (const r of rows) {
        if (r.conversation_id) seen.add(r.conversation_id);
        tokens += (Number(r.prompt_tokens) || 0) + (Number(r.completion_tokens) || 0);
      }
      if (rows.length < page) break;
    }
    conversations = seen.size;
  }

  // Resultados (voice_calls)
  const callsTotal = await admin
    .from('voice_calls')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', id)
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso);
  const callsConfirmed = await admin
    .from('voice_calls')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', id)
    .in('outcome', ['confirmed', 'recovered'])
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso);

  return NextResponse.json({
    activity: {
      sent: activitySent.count ?? 0,
      skipped: activitySkipped.count ?? 0,
      conversations,
    },
    results: {
      calls: callsTotal.count ?? 0,
      confirmed: callsConfirmed.count ?? 0,
    },
    cost: { tokens },
  });
}
