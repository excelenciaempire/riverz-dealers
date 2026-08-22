import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';

/**
 * Lo que el agente no supo contestar, agrupado.
 *
 * Agrupado y no en bruto: la misma pregunta hecha por doce personas distintas
 * es UN pedazo de conocimiento que falta cargar, no doce tareas. Ver esa lista
 * ordenada por cuánta gente preguntó es lo que convierte "el agente falló" en
 * "hay que escribir estas cinco cosas".
 *
 * PATCH marca el grupo entero como resuelto: quien carga la respuesta la carga
 * una vez, no doce.
 */
export const dynamic = 'force-dynamic';

async function contexto() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return null;
  return { admin, workspaceId, userId: user.id };
}

interface Fila {
  id: string;
  question: string;
  question_key: string;
  missing: string | null;
  channel: string | null;
  conversation_id: string | null;
  created_at: string;
}

export async function GET(request: Request) {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const incluirResueltos = new URL(request.url).searchParams.get('todos') === '1';
  let q = ctx.admin
    .from('answer_gaps')
    .select('id, question, question_key, missing, channel, conversation_id, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (!incluirResueltos) q = q.is('resolved_at', null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 502 });

  const grupos = new Map<
    string,
    { key: string; question: string; veces: number; ultima: string; missing: string | null; conversation_id: string | null }
  >();
  for (const f of (data ?? []) as Fila[]) {
    const g = grupos.get(f.question_key);
    if (g) {
      g.veces += 1;
      // Se guarda la falta de la primera que la haya dicho: repetirla no suma.
      if (!g.missing && f.missing) g.missing = f.missing;
    } else {
      grupos.set(f.question_key, {
        key: f.question_key,
        // La primera es la más reciente (viene ordenado): se muestra esa
        // redacción, que es la que alguien acaba de escribir.
        question: f.question,
        veces: 1,
        ultima: f.created_at,
        missing: f.missing,
        conversation_id: f.conversation_id,
      });
    }
  }

  const gaps = [...grupos.values()].sort(
    (a, b) => b.veces - a.veces || Date.parse(b.ultima) - Date.parse(a.ultima),
  );
  return NextResponse.json({ gaps });
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!key) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { error } = await ctx.admin
    .from('answer_gaps')
    .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
    .eq('workspace_id', ctx.workspaceId)
    .eq('question_key', key)
    .is('resolved_at', null);
  if (error) return NextResponse.json({ error: 'update_failed' }, { status: 502 });

  return NextResponse.json({ ok: true });
}
