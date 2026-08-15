import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { klaviyoHookToken } from '@/lib/integrations/klaviyo';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * GET /api/integrations/klaviyo/hook
 *
 * La URL que el comercio pega en la acción "Webhook" de un flujo de Klaviyo
 * para que ese flujo mande un WhatsApp. Se calcula acá y no en el navegador
 * porque el token es una firma con la clave del servidor.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ url: null });

  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  return NextResponse.json({
    url: `${base}/api/hooks/klaviyo/${klaviyoHookToken(workspaceId)}`,
  });
}
