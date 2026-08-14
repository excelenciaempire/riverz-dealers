import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { encrypt } from '@/lib/whatsapp/encryption';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { verifyToken } from '@/lib/mercadopago/client';
import { webhookUrl } from '@/lib/mercadopago/webhook-url';
import { oauthConfigured } from '@/lib/mercadopago/oauth';
import { publicBaseUrl } from '@/lib/base-url';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * Mercado Pago por workspace: el comerciante pega su Access Token de
 * producción y el cron `mercadopago-sync` empieza a traerle los pagos
 * rechazados para la automatización de recuperación.
 *
 *   GET    — ¿está conectado? (nunca devuelve el token)
 *   POST   — guarda/actualiza el token, validándolo antes contra la API.
 *   DELETE — desconecta.
 */

/**
 * Las escrituras van con service role a proposito.
 *
 * La migracion 078 le revoco el SELECT de tabla a `authenticated` para tapar
 * `api_key_encrypted` y dejo solo permisos por columna. El upsert de
 * PostgREST (INSERT ... ON CONFLICT) necesita ese SELECT de tabla, asi que
 * con la sesion del usuario devolvia "permission denied for table
 * workspace_integrations" y NINGUNA integracion se podia conectar: la tabla
 * estaba vacia en produccion justamente por eso.
 *
 * Devolverle el SELECT de tabla desharia esa decision de seguridad. La
 * autorizacion no se pierde: cada handler exige sesion y resuelve el
 * workspace del usuario antes de escribir.
 */
export async function GET() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.notAuthenticated') },
      { status: 401 },
    );
  }

  const { data } = await supabase
    .from('workspace_integrations')
    .select('is_active, updated_at, last_sync_at, expires_at, renew_failed_at')
    .eq('provider', 'mercadopago')
    .maybeSingle();
  const row = data as {
    is_active: boolean;
    updated_at: string;
    last_sync_at: string | null;
    expires_at: string | null;
    renew_failed_at: string | null;
  } | null;

  // Con OAuth la URL de avisos vive en la aplicación y no la pega nadie, así
  // que sólo se devuelve para las conexiones hechas con token pegado — que
  // son las únicas que la necesitan.
  const oauth = oauthConfigured();
  let notifyUrl: string | null = null;
  if (row?.is_active && !oauth) {
    const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
    if (workspaceId) {
      notifyUrl = webhookUrl(workspaceId, publicBaseUrl());
    }
  }

  // Cuándo avisarle al comerciante. Una conexión por OAuth que se renueva
  // sola NO genera aviso: ese es justamente el punto. Sólo se avisa cuando
  // el sistema no puede resolverlo por su cuenta.
  //
  //   renovacion_fallida — hay refresh pero el último intento falló (le
  //     revocó el permiso a la aplicación, o cambió el secreto).
  //     Reconectar lo arregla.
  //   vence_pronto — conexión hecha pegando el token, que no tiene refresh
  //     y hay que rotar a mano.
  //
  // `expires_at` sólo lo escribe el flujo de OAuth, así que su ausencia es
  // exactamente "esto se conectó a mano" y no hace falta otra bandera.
  const expiresAt = row?.expires_at ?? null;
  const msLeft = expiresAt ? new Date(expiresAt).getTime() - Date.now() : null;
  let alert: string | null = null;
  if (row?.is_active) {
    if (row.renew_failed_at) alert = 'renovacion_fallida';
    else if (msLeft !== null && msLeft < 14 * 86_400_000) alert = 'vence_pronto';
  }

  return NextResponse.json({
    connected: !!row?.is_active,
    updated_at: row?.updated_at ?? null,
    last_sync_at: row?.last_sync_at ?? null,
    expires_at: expiresAt,
    alert,
    notify_url: notifyUrl,
    oauth,
  });
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
  const token: string = (body.access_token ?? '').toString().trim();
  if (!token || token.length < 20) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.apiKeyInvalid') },
      { status: 400 },
    );
  }

  // Validar ANTES de guardar. Un token rota o se pega mal más seguido de lo
  // que uno cree, y sin este chequeo el error aparecería recién en el cron,
  // tres horas después y sin nadie mirando.
  let ok = false;
  try {
    ok = await verifyToken(token);
  } catch {
    ok = false;
  }
  if (!ok) {
    return NextResponse.json(
      { error: translate(locale, 'errAccount.mpTokenInvalid') },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin().from('workspace_integrations').upsert(
    {
      workspace_id: workspaceId,
      provider: 'mercadopago',
      api_key_encrypted: encrypt(token),
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

  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const { error } = await supabaseAdmin()
    .from('workspace_integrations')
    .update({ is_active: false })
    .eq('workspace_id', workspaceId)
    .eq('provider', 'mercadopago');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, connected: false });
}
