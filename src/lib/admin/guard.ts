import { NextResponse } from 'next/server';
import { actorDelPanel } from '@/lib/admin/unlock';

/**
 * Puerta única de las rutas `/api/admin/*`.
 *
 * El panel se abre con su contraseña, sin tener que iniciar sesión antes con
 * una cuenta del equipo (pedido del dueño, 2026-09-26): la contraseña firma una
 * cookie de 12 h a nombre de un admin del equipo, y eso es lo que se exige acá.
 * La contraseña vive sólo en el servidor (`ADMIN_PANEL_PASSWORD`) y los intentos
 * están limitados por IP en `/api/admin/unlock`.
 */
export interface AdminActor {
  userId: string;
  email: string;
}

type Gate = { ok: true; actor: AdminActor } | { ok: false; res: NextResponse };

export async function requireAdmin(): Promise<Gate> {
  const actor = await actorDelPanel();
  if (!actor) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'locked' }, { status: 403 }),
    };
  }
  return { ok: true, actor };
}
