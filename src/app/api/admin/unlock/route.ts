import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPlatformAdmin, TEAM_ADMINS } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/channels/admin-client';
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
 * POST /api/admin/unlock — abre el panel de plataforma en este navegador.
 *
 * Alcanza con la contraseña del panel: no hace falta haber iniciado sesión con
 * una cuenta del equipo (pedido del dueño, 2026-09-26). Los cambios se anotan a
 * nombre de quien tenga sesión si es del equipo, y si no, de la cuenta
 * principal del equipo. Los intentos se limitan por IP y con un tope global:
 * sin sesión no hay otra identidad por la cual contarlos.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  if (!unlockConfigured()) {
    return NextResponse.json(
      { error: translate(locale, 'admin.unlockUnconfigured') },
      { status: 503 },
    );
  }

  // Por IP y además un tope global: rotar la IP no da intentos infinitos.
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sin-ip';
  const porIp = await limitByKey(`admin-unlock:ip:${ip}`, { limit: 5, windowMs: 15 * 60_000 });
  const global = porIp.success
    ? await limitByKey('admin-unlock:global', { limit: 30, windowMs: 15 * 60_000 })
    : porIp;
  if (!porIp.success || !global.success) {
    const limit = !porIp.success ? porIp : global;
    return NextResponse.json(
      { error: translate(locale, 'admin.unlockRateLimited') },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === 'object' && 'password' in body ? body.password : null;
  const password = typeof input === 'string' && input.length <= 1024 ? input.trim() : '';
  if (!password || !passwordMatches(password)) {
    return NextResponse.json({ error: translate(locale, 'admin.unlockIncorrect') }, { status: 401 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actor =
    user && isPlatformAdmin(user.email)
      ? { email: user.email ?? '', userId: user.id }
      : await cuentaDelEquipo();
  if (!actor) {
    return NextResponse.json({ error: translate(locale, 'admin.unlockFailed') }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: UNLOCK_COOKIE,
    value: issueToken(actor.email, actor.userId),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });
  return res;
}

/** La cuenta principal del equipo, para anotar los cambios hechos sin sesión. */
async function cuentaDelEquipo(): Promise<{ email: string; userId: string } | null> {
  const email = TEAM_ADMINS[0];
  const admin = supabaseAdmin();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
    if (u) return { email, userId: u.id };
    if (data.users.length < 200) break;
  }
  return null;
}

/** DELETE — cerrar el panel a mano (sin esperar las 12 h). */
export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: UNLOCK_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}
