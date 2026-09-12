import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import {
  UNLOCK_COOKIE,
  UNLOCK_TTL_MS,
  issueToken,
  passwordMatches,
  unlockConfigured,
} from '@/lib/admin/unlock';
import { csrfGuard } from '@/lib/csrf';
import { limitByKey } from '@/lib/rate-limit';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/admin/unlock — abre el panel de plataforma por esta sesión.
 *
 * Pide las dos cosas: sesión de un admin del equipo Y la contraseña del panel.
 * Responde 404 a quien no sea admin (igual que el layout: quien no debería
 * saber que el panel existe, no se entera por esta ruta).
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isPlatformAdmin(user.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const locale = await getLocale();
  if (!unlockConfigured()) {
    return NextResponse.json(
      { error: translate(locale, 'admin.unlockUnconfigured') },
      { status: 503 },
    );
  }

  // Bound attempts by verified identity, so rotating IP headers cannot reset them.
  const limit = await limitByKey(`admin-unlock:${user.id}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!limit.success) {
    return NextResponse.json(
      { error: translate(locale, 'admin.unlockRateLimited') },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === 'object' && 'password' in body ? body.password : null;
  const password = typeof input === 'string' && input.length <= 1024 ? input.trim() : '';
  if (!password || !passwordMatches(password)) {
    // Sin pistas sobre qué parte falló.
    return NextResponse.json({ error: translate(locale, 'admin.unlockIncorrect') }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: UNLOCK_COOKIE,
    value: issueToken(user.email ?? ''),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });
  return res;
}

/** DELETE — cerrar el panel a mano (sin esperar las 12 h). */
export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: UNLOCK_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}
