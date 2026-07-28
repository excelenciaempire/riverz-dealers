import { NextResponse } from 'next/server';
import { getLogger } from '@/lib/log/logger';
import { limitByKey, rateLimitResponse, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Recibe errores del navegador y los emite por el logger del servidor.
 *
 * `src/app/error.tsx` y `global-error.tsx` ya llamaban a `captureException`,
 * pero el cargador de Sentry aborta fuera del runtime de Node: **ningún error
 * de cliente llegaba a ninguna parte**. Este puente los mete en el mismo canal
 * que todo lo demás.
 *
 * Es público por necesidad (un error puede ocurrir antes de tener sesión), así
 * que va limitado por IP y con el cuerpo acotado — si no, es un buzón abierto
 * para llenar los logs.
 */
const RATE = { limit: 20, windowMs: 60_000 };
const MAX_FIELD = 2000;

interface Body {
  message?: string;
  stack?: string;
  digest?: string;
  url?: string;
  scope?: string;
}

function clip(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  return v.slice(0, MAX_FIELD);
}

export async function POST(request: Request) {
  const rl = await limitByKey(`client-errors:${clientIp(request)}`, RATE);
  if (!rl.success) return rateLimitResponse(rl);

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }

  getLogger('client').error(clip(body.message) ?? 'client error', {
    stack: clip(body.stack),
    digest: clip(body.digest),
    url: clip(body.url),
    scope: clip(body.scope),
    userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
