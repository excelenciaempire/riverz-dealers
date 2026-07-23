import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * Redirector público de short links: `/r/:token` → 302 al link real del
 * cliente. Es el destino fijo de los botones URL dinámicos de plantillas
 * (`https://riverz.co/r/{{1}}`), aprobado UNA vez por Meta y reutilizado para
 * cualquier link por cliente (carrito, estado del pedido, tracking).
 *
 * Público a propósito (lo abre el cliente desde WhatsApp). No es un
 * open-redirect: solo redirige a URLs que nosotros mismos guardamos al enviar,
 * nunca a un destino tomado del request.
 */
export const dynamic = 'force-dynamic';

const FALLBACK = (process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co').replace(
  /\/+$/,
  '',
);

export async function GET(
  _req: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const db = supabaseAdmin();

  const { data } = await db
    .from('short_links')
    .select('target_url, click_count')
    .eq('token', token)
    .maybeSingle();

  const target = (data as { target_url?: string } | null)?.target_url;
  if (!target || !target.trim()) {
    // Token inválido/expirado → a la home en vez de un 404 seco.
    return NextResponse.redirect(FALLBACK, 302);
  }

  // Registro de clic best-effort — nunca bloquea la redirección.
  void db
    .from('short_links')
    .update({
      last_clicked_at: new Date().toISOString(),
      click_count: ((data as { click_count?: number }).click_count ?? 0) + 1,
    })
    .eq('token', token);

  return NextResponse.redirect(target, 302);
}
