import { adminGet } from '@/lib/admin/route';
import { leerCostosFijosConCache } from '@/lib/admin/costos-fijos';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/costos-fijos — lo que se paga todos los meses aunque nadie use
 * nada, agrupado por proyecto.
 *
 * Existe como ruta propia desde que el bloque se mudó a la Caja: iba de arriba
 * en la respuesta de proveedores, que además dispara sondas FACTURABLES. Pedir
 * «cuánto sale el mes» no tiene por qué costar cuatro completions.
 *
 * La caché está en la librería porque la ronda de proveedores también lo lee.
 */
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.fixed_costs' }, leerCostosFijosConCache);
}
