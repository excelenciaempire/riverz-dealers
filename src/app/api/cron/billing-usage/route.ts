import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { acumularDia } from '@/lib/billing/uso';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';

/**
 * GET /api/cron/billing-usage
 *
 * Acumula el consumo del día en `billing_usage_daily`: conversaciones
 * atendidas por IA, respuestas, tokens y lo que nos costó.
 *
 * Corre sobre AYER y sobre HOY. Ayer porque a esta hora ya cerró y el número
 * es definitivo; hoy porque si no, la pantalla del comercio mostraría el
 * consumo con un día de atraso y la primera pregunta sería por qué no aparece
 * lo de esta mañana.
 *
 * Volver a correrlo es seguro: la clave es (cuenta, día) y se pisa. Tiene que
 * serlo, o el primer error de conteo queda grabado para siempre.
 *
 * Acepta `?dia=YYYY-MM-DD` para recalcular una fecha suelta a mano.
 *
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const pedido = new URL(request.url).searchParams.get('dia');
  const db = supabaseAdmin();

  try {
    if (pedido) {
      const fecha = new Date(`${pedido}T00:00:00Z`);
      if (Number.isNaN(fecha.getTime())) {
        return NextResponse.json({ error: 'fecha inválida' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, dias: [await acumularDia(db, fecha)] });
    }

    const hoy = new Date();
    const ayer = new Date(hoy.getTime() - 24 * 60 * 60 * 1000);
    const dias = [await acumularDia(db, ayer), await acumularDia(db, hoy)];
    return NextResponse.json({ ok: true, dias }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withCronRun('billing-usage', cronHandler);
