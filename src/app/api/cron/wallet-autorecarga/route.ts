import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';
import { stripeDisponible } from '@/lib/billing/stripe';
import { recargarLasQueHagaFalta } from '@/lib/wallet/auto';

/**
 * GET /api/cron/wallet-autorecarga
 *
 * Recarga a todo comercio que haya bajado del umbral y tenga tarjeta guardada.
 *
 * Cada 5 minutos y no cada minuto: entre que el saldo cae y que la IA se queda
 * muda hay margen —el descubierto— y un cobro con tarjeta no es una operación
 * que convenga apurar. Cinco minutos es lo bastante seguido para que nadie se
 * entere de que estuvo en cero, y lo bastante espaciado para que un fallo no se
 * multiplique por sesenta.
 *
 * Sin Stripe configurado no hace nada y contesta ok: no es un error, es una
 * plataforma que todavía no cobra.
 *
 * Auth: `x-cron-secret` contra `AUTOMATION_CRON_SECRET`.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  if (!stripeDisponible()) {
    return NextResponse.json({ ok: true, nota: 'facturación sin configurar' });
  }

  const res = await recargarLasQueHagaFalta(supabaseAdmin());
  return NextResponse.json({ ok: true, ...res });
}

export const GET = withCronRun('wallet-autorecarga', cronHandler);
export const POST = GET;
export const dynamic = 'force-dynamic';
