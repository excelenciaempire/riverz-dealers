import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';

/**
 * GET /api/inbox/assignment-rules — lista reglas del workspace.
 * POST /api/inbox/assignment-rules — crea o updatea. Body:
 *   { id?, name, is_active, priority, kind, config }
 * DELETE /api/inbox/assignment-rules?id=
 *
 * Solo admins/owners pueden modificar (RLS lo enforce con el role).
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data, error } = await supabase
    .from('conversation_assignment_rules')
    .select('id, name, is_active, priority, kind, channel, config, created_at')
    .order('priority', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    name?: string;
    is_active?: boolean;
    priority?: number;
    kind?: 'round_robin' | 'by_tag' | 'by_channel' | 'by_keyword';
    channel?: string | null;
    config?: Record<string, unknown>;
  } | null;
  if (!body?.name || !body.kind) {
    return NextResponse.json({ error: 'Faltan name o kind' }, { status: 400 });
  }
  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!member?.workspace_id) {
    return NextResponse.json({ error: 'No workspace' }, { status: 400 });
  }
  // `channel` se trata como "cualquiera" cuando el cliente manda null o
  // string vacío — no hay que persistir un literal "cualquiera" porque
  // ya tenemos un valor canónico (NULL) en la columna.
  const channelValue =
    typeof body.channel === 'string' && body.channel.length > 0
      ? body.channel
      : null;
  if (body.id) {
    const { error } = await supabase
      .from('conversation_assignment_rules')
      .update({
        name: body.name,
        is_active: body.is_active ?? true,
        priority: body.priority ?? 100,
        kind: body.kind,
        channel: channelValue,
        config: body.config ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const { data, error } = await supabase
    .from('conversation_assignment_rules')
    .insert({
      workspace_id: member.workspace_id,
      name: body.name,
      is_active: body.is_active ?? true,
      priority: body.priority ?? 100,
      kind: body.kind,
      channel: channelValue,
      config: body.config ?? {},
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  }
  const { error } = await supabase
    .from('conversation_assignment_rules')
    .delete()
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
