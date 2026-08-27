import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { encrypt } from '@/lib/whatsapp/encryption';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * El píxel de Meta del comercio, para contarle las ventas del chat.
 *
 * Hacen falta dos cosas y las dos las da Meta en el Administrador de eventos:
 * el ID del píxel —que es público, va en el HTML de la tienda— y un token de
 * la API de Conversiones, que NO lo es: con él se pueden mandar eventos en
 * nombre del comercio. Por eso el token se guarda cifrado y no vuelve a salir
 * nunca de acá; el ID sí, porque es lo que el comercio necesita ver para saber
 * que conectó el correcto.
 *
 * Las escrituras van con service role por lo mismo que el resto de las
 * integraciones: la migración 078 le sacó el SELECT de tabla a `authenticated`
 * justamente para tapar `api_key_encrypted`, y el upsert de PostgREST lo
 * necesita. La autorización no se pierde — acá se exige sesión y se resuelve
 * el workspace antes de escribir.
 */

const PROVEEDOR = 'meta_pixel';

async function sesion() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const locale = await getLocale();
  const { supabase, user } = await sesion();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.notAuthenticated') },
      { status: 401 },
    );
  }

  const { data } = await supabase
    .from('workspace_integrations')
    .select('is_active, external_account_id, updated_at')
    .eq('provider', PROVEEDOR)
    .maybeSingle();
  const row = data as {
    is_active: boolean;
    external_account_id: string | null;
    updated_at: string;
  } | null;
  return NextResponse.json({
    connected: !!row?.is_active,
    // El ID es público; el token no vuelve nunca.
    pixel_id: row?.external_account_id ?? null,
    updated_at: row?.updated_at ?? null,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  const { supabase, user } = await sesion();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.notAuthenticated') },
      { status: 401 },
    );
  }

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.noWorkspace') },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const pixelId: string = (body.pixel_id ?? '').toString().trim();
  const token: string = (body.access_token ?? '').toString().trim();

  // El ID del píxel es un número largo. Pedirlo bien acá evita que el comercio
  // pegue el nombre del píxel y se pase una semana preguntándose por qué no
  // llegan las ventas.
  if (!/^\d{8,20}$/.test(pixelId)) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.metaPixelIdInvalid') },
      { status: 400 },
    );
  }
  if (token.length < 20) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.apiKeyInvalid') },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin().from('workspace_integrations').upsert(
    {
      workspace_id: workspaceId,
      provider: PROVEEDOR,
      external_account_id: pixelId,
      api_key_encrypted: encrypt(token),
      is_active: true,
      created_by: user.id,
    },
    { onConflict: 'workspace_id,provider' },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, connected: true, pixel_id: pixelId });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  const { supabase, user } = await sesion();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.notAuthenticated') },
      { status: 401 },
    );
  }

  const { error } = await supabase
    .from('workspace_integrations')
    .delete()
    .eq('provider', PROVEEDOR);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, connected: false });
}
