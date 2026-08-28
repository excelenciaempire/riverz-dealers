import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { collectMerchantIssues } from '@/lib/health/issues';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { serverError } from '@/lib/api/errors';

/**
 * GET /api/health/issues
 *
 * Lo que necesita atención en el workspace de quien pregunta, y que ese
 * workspace puede arreglar: lo que es nuestro no llega hasta acá, se ve entero
 * en /admin. Los avisos ocultados tampoco vuelven hasta que el problema pase de
 * nuevo.
 *
 * Se resuelve del lado del servidor con la clave de servicio porque la
 * detección cruza tablas que el navegador no puede leer enteras (las esperas
 * encoladas son sólo de servidor) — pero el workspace sale de la SESIÓN, nunca
 * del pedido, así que nadie puede pedir el estado de otro comercio.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ issues: [] });

  try {
    const issues = await collectMerchantIssues(supabaseAdmin(), workspaceId);
    return NextResponse.json({ issues });
  } catch (err) {
    return serverError(err);
  }
}
