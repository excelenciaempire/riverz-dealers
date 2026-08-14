import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { authorizeUrl, oauthConfigured } from '@/lib/mercadopago/oauth';

/**
 * Arranque del "Conectar" de Mercado Pago: manda al comerciante a autorizar.
 *
 * Va como GET y redirect —y no como fetch— para que el navegador salga del
 * sitio de verdad: la pantalla de Mercado Pago no se puede abrir dentro de
 * un iframe ni consumir por API.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/ingresar', 'https://riverz.co'));
  }

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 403 });
  }

  // Sin credenciales de aplicación no hay a dónde mandarlo. Se dice acá y no
  // en una pantalla de Mercado Pago que culparía al comerciante.
  if (!oauthConfigured()) {
    return NextResponse.json({ error: 'oauth_not_configured' }, { status: 503 });
  }

  return NextResponse.redirect(authorizeUrl(workspaceId));
}
