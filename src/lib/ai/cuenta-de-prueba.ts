import type { supabaseAdmin } from '@/lib/channels/admin-client';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { verificarTokenDePrueba } from './prueba-compartida';

export interface CuentaDeLaPrueba {
  workspaceId: string | null;
  /** Vino por el link compartido, sin sesión. */
  compartida: boolean;
  conSesion: boolean;
  userId: string | null;
}

/**
 * De qué cuenta es la prueba: la del link compartido, si viene uno, o la de
 * quien tiene la sesión abierta.
 */
export async function cuentaDeLaPrueba(
  admin: ReturnType<typeof supabaseAdmin>,
  token: unknown
): Promise<CuentaDeLaPrueba> {
  if (token != null && token !== '') {
    return { workspaceId: verificarTokenDePrueba(token), compartida: true, conSesion: false, userId: null };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { workspaceId: null, compartida: false, conSesion: false, userId: null };
  return {
    workspaceId: await resolveWorkspaceIdForUser(admin, user.id),
    compartida: false,
    conSesion: true,
    userId: user.id,
  };
}
