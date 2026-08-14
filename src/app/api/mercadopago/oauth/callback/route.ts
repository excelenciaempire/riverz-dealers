import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { publicBaseUrl } from '@/lib/base-url';
import { exchangeCode, verifyState } from '@/lib/mercadopago/oauth';
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
function back(status: string) {
  return NextResponse.redirect(`${publicBaseUrl()}/integraciones?mercadopago=${status}`);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';

  const workspaceId = verifyState(state);
  if (!workspaceId) return back('estado_invalido');

  // El comerciante cerró la pantalla o negó el permiso.
  if (!code) return back('cancelado');

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.accessToken) return back('error');

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
      return back('error');
    }

    return back('conectado');
  } catch (err) {
    log.captureException(err, { workspaceId });
    return back('error');
  }
}
