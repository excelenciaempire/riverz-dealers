import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';
import { requireAdmin, type AdminActor } from './guard';
import { recordAdminView, type AdminAction } from './audit';

/**
 * Envoltorio de las rutas GET del panel de plataforma.
 *
 * Cada ruta hace lo mismo antes de responder: comprobar que quien llama es del
 * equipo, limitar el ritmo, dejar constancia en la auditoría y no cachear.
 * Repetir eso ocho veces era la forma segura de que la novena se olvidara de
 * un paso.
 */

const ADMIN_RATE = { limit: 120, windowMs: 60_000 };

interface AuditSpec {
  action: AdminAction;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

export async function adminGet(
  request: Request,
  audit: AuditSpec | ((actor: AdminActor) => AuditSpec),
  handler: (actor: AdminActor) => Promise<unknown>,
): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const actor = gate.actor;

  const rl = await limitByKey(`admin:${actor.email}`, ADMIN_RATE);
  if (!rl.success) return rateLimitResponse(rl);

  const spec = typeof audit === 'function' ? audit(actor) : audit;
  recordAdminView(actor, request, spec);

  try {
    const payload = await handler(actor);
    // Un handler puede devolver su propia respuesta (p. ej. un 404 cuando el
    // id no existe) en vez de un cuerpo JSON.
    if (payload instanceof NextResponse) return payload;
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return serverError(err, `admin ${spec.action} failed`);
  }
}

/** Rango de fechas de los query params, con un defecto de 30 días. */
export function rangeFromSearch(url: URL): { from: Date; to: Date } {
  const now = new Date();
  const toParam = url.searchParams.get('to');
  const fromParam = url.searchParams.get('from');
  const to = toParam ? new Date(toParam) : now;
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Fechas basura no pueden tumbar la pantalla: se cae al defecto.
  const valid = (d: Date) => !Number.isNaN(d.getTime());
  return {
    from: valid(from) ? from : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    to: valid(to) ? to : now,
  };
}

/** Entero acotado de un query param. */
export function intParam(
  url: URL,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = Number(url.searchParams.get(name));
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  return Math.min(Math.floor(raw), max);
}
