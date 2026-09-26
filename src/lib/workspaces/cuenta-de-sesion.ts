import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * La cuenta de quien tiene la sesión abierta, para las rutas que leen y
 * escriben con la llave de servicio sobre tablas sin acceso del navegador.
 * Devuelve la respuesta de error lista cuando no hay sesión o cuenta.
 */
export async function cuentaDeSesion(): Promise<
  | { admin: SupabaseClient; workspaceId: string; userId: string; locale: Locale }
  | { error: NextResponse }
> {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: translate(locale, 'errAi.unauthorized') }, { status: 401 }) };
  }
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) {
    return { error: NextResponse.json({ error: translate(locale, 'errAi.forbidden') }, { status: 403 }) };
  }
  return { admin, workspaceId, userId: user.id, locale };
}
