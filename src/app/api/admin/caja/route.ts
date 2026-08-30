import { supabaseAdmin } from '@/lib/channels/admin-client';
import { adminGet } from '@/lib/admin/route';
import { leerCaja } from '@/lib/admin/caja';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/caja — cuánta plata hay, cuánto aguanta y qué hacer ahora.
 *
 * No cachea acá: la parte cara —las sondas facturables de los proveedores— ya
 * viene de `leerProveedoresConCache`, y lo demás son dos consultas a Supabase y
 * tres llamadas gratuitas a Stripe. Una caché propia sólo agregaría una segunda
 * verdad sobre el mismo número.
 */
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.cash' }, () => leerCaja(supabaseAdmin()));
}
