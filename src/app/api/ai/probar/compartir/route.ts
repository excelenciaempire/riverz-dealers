import { NextResponse } from 'next/server';
import { tokenDePrueba, VIDA_DEL_LINK_MS } from '@/lib/ai/prueba-compartida';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * POST /api/ai/probar/compartir → { url, vence }
 *
 * El link de "Probar como cliente" para mandárselo a alguien que no entra a
 * Riverz —el dueño de la marca— y que pruebe desde su teléfono.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: translate(locale, 'errAi.unauthorized') }, { status: 401 });
  }
  const workspaceId = await resolveWorkspaceIdForUser(supabaseAdmin(), user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: translate(locale, 'errAi.forbidden') }, { status: 403 });
  }
  const ahora = Date.now();
  // El dominio público: detrás del proxy, la URL del pedido puede ser la
  // interna del servidor.
  const publico = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  const origen =
    /^https:\/\//i.test(publico) && !/localhost|127\.0\.0\.1/i.test(publico)
      ? publico
      : new URL(request.url).origin;
  return NextResponse.json({
    url: `${origen}/probar/${tokenDePrueba(workspaceId, ahora)}`,
    vence: new Date(ahora + VIDA_DEL_LINK_MS).toISOString(),
  });
}
