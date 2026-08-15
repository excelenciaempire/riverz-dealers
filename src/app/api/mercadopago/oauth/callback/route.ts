import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { publicBaseUrl } from '@/lib/base-url';
import { exchangeCode, verifyState, PKCE_COOKIE } from '@/lib/mercadopago/oauth';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('mercadopago.oauth');

/**
 * Vuelta de la autorización de Mercado Pago.
 *
 * El workspace viene firmado dentro del `state`, así que no hace falta
 * sesión: el comerciante puede terminar el flujo en otra pestaña o después
 * de un login intermedio y la conexión igual aterriza donde corresponde.
 *
 * La escritura va con service role por lo mismo que el resto de las
 * integraciones: la migración 078 le sacó a `authenticated` el SELECT de
 * tabla para tapar los secretos, y sin él el upsert de PostgREST falla.
 */
/**
 * Vuelve a Integraciones con el resultado. Cuando falla viaja además una
 * pista corta: sin ella, "no se pudo conectar" obliga a abrir los registros
 * del servidor para saber si fue la aplicación mal registrada, el permiso
 * negado o un token vencido — y quien conecta no tiene esos registros.
 */
function back(status: string, detail?: string) {
  const url = new URL('/integraciones', publicBaseUrl());
  url.searchParams.set('mercadopago', status);
  if (detail) url.searchParams.set('detalle', detail.slice(0, 200));
  const res = NextResponse.redirect(url.toString());
  // El secreto de PKCE sirve una sola vez, salga bien o mal.
  res.cookies.delete(PKCE_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';

  const workspaceId = verifyState(state);
  if (!workspaceId) return back('estado_invalido');

  // El comerciante cerró la pantalla o negó el permiso.
  if (!code) return back('cancelado');

  // El secreto de PKCE quedó en una cookie al empezar. Si no está, la
  // autorización arrancó en otro navegador o pasaron más de diez minutos:
  // se vuelve a empezar, que es lo único que lo arregla.
  const verifier = request.cookies.get(PKCE_COOKIE)?.value;
  if (!verifier) return back('reintentar');

  try {
    const tokens = await exchangeCode(code, verifier);
    if (!tokens.accessToken) return back('error', 'sin access_token');

    const admin = supabaseAdmin();

    // Una misma cuenta de Mercado Pago en dos workspaces haría que una
    // notificación no sepa a cuál pertenece — el índice único lo impide, y
    // acá se limpia la conexión anterior para que reconectar en otro
    // workspace funcione en vez de chocar.
    if (tokens.userId) {
      await admin
        .from('workspace_integrations')
        .update({ external_account_id: null, is_active: false })
        .eq('provider', 'mercadopago')
        .eq('external_account_id', tokens.userId)
        .neq('workspace_id', workspaceId);
    }

    const { error } = await admin.from('workspace_integrations').upsert(
      {
        workspace_id: workspaceId,
        provider: 'mercadopago',
        api_key_encrypted: encrypt(tokens.accessToken),
        refresh_token_encrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
        external_account_id: tokens.userId,
        expires_at: tokens.expiresAt,
        is_active: true,
      },
      { onConflict: 'workspace_id,provider' },
    );
    if (error) {
      log.captureException(error, { workspaceId });
      return back('error', error.message);
    }

    return back('conectado');
  } catch (err) {
    log.captureException(err, { workspaceId });
    return back('error', err instanceof Error ? err.message : String(err));
  }
}
