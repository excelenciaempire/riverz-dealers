import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { marcarEnlace } from '@/lib/marketing/enlaces';

/**
 * Redirector público de short links: `/r/:token` → 302 al link real del
 * cliente. Lo usan tanto los botones URL dinámicos de plantillas como los
 * enlaces incluidos en mensajes de texto.
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

/**
 * Sólo http(s). El destino lo escribimos nosotros al enviar, pero el enlace
 * sale con nuestro dominio delante: si una fila llegara mal formada, riverz.co
 * quedaría rebotando a un `javascript:` o a un `data:`, y la reputación del
 * dominio frente a Meta es justo lo que no conviene arriesgar. Ante la duda,
 * a la home.
 */
function isSafeRedirectTarget(target: string | undefined): target is string {
  if (!target || !target.trim()) return false;
  try {
    const protocol = new URL(target.trim()).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

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
  if (!isSafeRedirectTarget(target)) {
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

  // Los mensajes de texto guardan como destino una URL ya marcada con su canal;
  // `marcarEnlace` es idempotente y la conserva. Los botones históricos de
  // plantilla guardaron el destino sin marca, así que reciben `plantilla` acá.
  return NextResponse.redirect(marcarEnlace(target, { medio: 'plantilla' }), 302);
}
