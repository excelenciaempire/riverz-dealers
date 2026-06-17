import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { encrypt } from '@/lib/whatsapp/encryption';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';

/**
 * Klaviyo integration (por workspace) para el sync de leads del Agente de
 * Instagram.
 *   GET    — ¿está conectado?
 *   POST   — guarda/actualiza la API key (encriptada). Nunca se devuelve.
 *   DELETE — desconecta.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data } = await supabase
    .from('workspace_integrations')
    .select('is_active, updated_at')
    .eq('provider', 'klaviyo')
    .maybeSingle();
  const row = data as { is_active: boolean; updated_at: string } | null;
  return NextResponse.json({
    connected: !!row?.is_active,
    updated_at: row?.updated_at ?? null,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'Sin workspace' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const apiKey: string = (body.api_key ?? '').toString().trim();
  if (!apiKey || apiKey.length < 10) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 400 });
  }

  const { error } = await supabase.from('workspace_integrations').upsert(
    {
      workspace_id: workspaceId,
      provider: 'klaviyo',
      api_key_encrypted: encrypt(apiKey),
      is_active: true,
      created_by: user.id,
    },
    { onConflict: 'workspace_id,provider' },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, connected: true });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { error } = await supabase
    .from('workspace_integrations')
    .delete()
    .eq('provider', 'klaviyo');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, connected: false });
}
