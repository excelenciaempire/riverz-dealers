import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/inbox/filters — lista los filtros guardados del usuario.
 * POST /api/inbox/filters — crea uno nuevo. Body: { name, config }
 * DELETE /api/inbox/filters?id=... — elimina uno (RLS protege que sea del user).
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
    .from('inbox_saved_filters')
    .select('id, name, config, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ filters: data ?? [] });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    config?: Record<string, unknown>;
  } | null;
  if (!body?.name?.trim()) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingName') },
      { status: 400 },
    );
  }
  // Resuelve workspace del usuario.
  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!member?.workspace_id) {
    return NextResponse.json({ error: 'No workspace' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('inbox_saved_filters')
    .insert({
      workspace_id: member.workspace_id,
      user_id: user.id,
      name: body.name.trim(),
      config: body.config ?? {},
    })
    .select('id, name, config, sort_order')
    .single();
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ filter: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
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
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingId') },
      { status: 400 },
    );
  }
  const { error } = await supabase
    .from('inbox_saved_filters')
    .delete()
    .eq('id', id);
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ ok: true });
}
