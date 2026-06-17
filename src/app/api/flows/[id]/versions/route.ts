import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';

/**
 * GET /api/flows/[id]/versions — lista las últimas 50 versiones del
 *   flujo (draft + published, sin autosave por ahora).
 * POST /api/flows/[id]/versions — crea una versión con el snapshot
 *   actual del flujo. Body: { kind, note? }
 *
 * El restore vive en /api/flows/[id]/versions/[versionId]/restore
 * porque es una acción específica y conviene tenerla con su propio
 * endpoint para tracking.
 */

interface SnapshotShape {
  flow: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
}

export async function GET(
  _request: Request,
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
  const { data, error } = await supabase
    .from('flow_versions')
    .select('id, kind, note, created_at, created_by')
    .eq('flow_id', id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ versions: data ?? [] });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    kind?: 'draft' | 'published';
    note?: string;
  } | null;
  if (!body?.kind) {
    return NextResponse.json({ error: 'Falta kind' }, { status: 400 });
  }
  const admin = supabaseAdmin();
  // Snapshot del flujo entero.
  const [{ data: flow }, { data: nodes }] = await Promise.all([
    admin.from('flows').select('*').eq('id', id).maybeSingle(),
    admin.from('flow_nodes').select('*').eq('flow_id', id),
  ]);
  if (!flow) {
    return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
  }
  const snapshot: SnapshotShape = {
    flow: flow as Record<string, unknown>,
    nodes: (nodes ?? []) as Array<Record<string, unknown>>,
  };

  // Si kind=draft, reemplazamos el draft anterior (no acumulamos).
  if (body.kind === 'draft') {
    await admin
      .from('flow_versions')
      .delete()
      .eq('flow_id', id)
      .eq('kind', 'draft');
  }

  const { data, error } = await admin
    .from('flow_versions')
    .insert({
      flow_id: id,
      kind: body.kind,
      snapshot,
      note: body.note ?? null,
      created_by: user.id,
    })
    .select('id, kind, note, created_at, created_by')
    .single();
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ version: data }, { status: 201 });
}
