import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { syncContactsBatch } from '@/lib/contacts/sync-all';
import { assertCronAuth } from '@/lib/auth/cron';
import { pingCron } from '@/lib/cron/heartbeat';

/**
 * GET /api/cron/contacts-sync
 *
 * Completa y reclasifica la ficha de los contactos por lotes: trae de Shopify
 * dirección, pedidos y gasto, y deriva de ahí las etiquetas (comprador,
 * comprador-recurrente, oferta, unidades).
 *
 * Prioriza los que nunca se sincronizaron —o sea, los nuevos— y después rota
 * por los más viejos, así ningún dato queda congelado. El resultado incluye
 * `pending`: cuántos contactos faltan. Cuando llega a 0, la base está al día.
 *
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  void pingCron('contacts-sync');

  try {
    const result = await syncContactsBatch(supabaseAdmin());
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
