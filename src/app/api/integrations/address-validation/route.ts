import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { encrypt } from '@/lib/whatsapp/encryption';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { testGoogleAddressValidationKey } from '@/lib/addresses/google-validation';

const PROVIDER = 'google_address_validation';

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const locale = await getLocale();
  const { supabase, user } = await session();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.notAuthenticated') },
      { status: 401 }
    );
  }
  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.noWorkspace') },
      { status: 403 }
    );
  }
  const { data, error } = await supabaseAdmin()
    .from('workspace_integrations')
    .select('id,is_active,api_key_encrypted,updated_at')
    .eq('workspace_id', workspaceId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    configured: Boolean(data?.api_key_encrypted),
    enabled: data?.is_active === true,
    updated_at: data?.updated_at ?? null,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  const { supabase, user } = await session();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.notAuthenticated') },
      { status: 401 }
    );
  }
  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.noWorkspace') },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    api_key?: unknown;
    enabled?: unknown;
  };
  const key = typeof body.api_key === 'string' ? body.api_key.trim() : '';
  const enabled = body.enabled !== false;
  const admin = supabaseAdmin();
  const { data: existing, error: readError } = await admin
    .from('workspace_integrations')
    .select('id,api_key_encrypted')
    .eq('workspace_id', workspaceId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (readError)
    return NextResponse.json({ error: readError.message }, { status: 500 });

  if (enabled && !key && !existing?.api_key_encrypted) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.addressValidationKeyRequired') },
      { status: 400 }
    );
  }
  // Apagar una integración que todavía no fue configurada es un no-op. Así
  // evitamos crear una fila con un secreto vacío sólo por mover el interruptor.
  if (!enabled && !key && !existing) {
    return NextResponse.json({ configured: false, enabled: false });
  }
  if (key) {
    if (key.length < 20 || /\s/.test(key)) {
      return NextResponse.json(
        { error: translate(locale, 'errAccount.apiKeyInvalid') },
        { status: 400 }
      );
    }
    if (!(await testGoogleAddressValidationKey(key))) {
      return NextResponse.json(
        { error: translate(locale, 'errAccount.addressValidationKeyRejected') },
        { status: 400 }
      );
    }
  }

  const now = new Date().toISOString();
  const result = existing
    ? await admin
        .from('workspace_integrations')
        .update({
          is_active: enabled,
          ...(key ? { api_key_encrypted: encrypt(key) } : {}),
          updated_at: now,
        })
        .eq('id', existing.id)
    : await admin.from('workspace_integrations').insert({
        workspace_id: workspaceId,
        provider: PROVIDER,
        api_key_encrypted: encrypt(key),
        is_active: enabled,
        created_by: user.id,
        updated_at: now,
      });
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return NextResponse.json({
    configured: Boolean(key || existing?.api_key_encrypted),
    enabled,
  });
}
