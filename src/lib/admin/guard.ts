import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { isUnlocked } from '@/lib/admin/unlock';

/**
 * Puerta única de las rutas `/api/admin/*`.
 *
 * Antes cada ruta repetía a mano el mismo par getUser()+isPlatformAdmin, con
 * el riesgo de que una nueva se olvidara de una mitad. Todas pasan por aquí.
 *
 * Devuelve 401 si no hay sesión y 403 si la hay pero no es del equipo. La
 * diferencia con el layout de `/admin` (que responde 404 para esconder que el
 * panel existe) es deliberada: a la API solo llega quien ya vio el panel.
 */
export interface AdminActor {
  userId: string;
  email: string;
}

type Gate = { ok: true; actor: AdminActor } | { ok: false; res: NextResponse };

export async function requireAdmin(): Promise<Gate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  if (!isPlatformAdmin(user.email)) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    };
  }
  // La contraseña del panel vale también para la API. Sin esto, la segunda
  // llave sería sólo de la pantalla: cualquiera con la sesión de un admin
  // llamaría a /api/admin/* directo y se la saltearía entera.
  if (!(await isUnlocked(user.email ?? ''))) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'locked' }, { status: 403 }),
    };
  }
  return { ok: true, actor: { userId: user.id, email: user.email ?? '' } };
}
