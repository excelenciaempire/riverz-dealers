import { adminGet } from '@/lib/admin/route';
import { leerProveedoresConCache } from '@/lib/admin/proveedores';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/proveedores — saldo, estado y costo fijo, en una sola ronda.
 *
 * Reemplaza a `/api/admin/saldos` y `/api/admin/infrastructure`, que sondeaban
 * los mismos cinco proveedores por separado.
 *
 * La caché está en `lib/admin/proveedores` y no acá: la Caja pide los mismos
 * saldos, y varias de estas sondas son completions FACTURABLES. Con la caché en
 * la ruta, abrir las dos pantallas eran dos rondas pagas.
 */
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.provider_balances' }, leerProveedoresConCache);
}
