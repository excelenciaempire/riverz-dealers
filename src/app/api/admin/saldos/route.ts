import { adminGet } from '@/lib/admin/route';
import { cuantosEnRojo, leerSaldosDeProveedores } from '@/lib/admin/saldos';

/**
 * GET /api/admin/saldos
 *
 * El saldo de cada proveedor que hay que recargar para que la plataforma siga
 * andando. Consulta seis APIs externas, así que no se refresca sola: la pide la
 * pantalla cuando alguien la abre o toca actualizar.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return adminGet(request, { action: 'view.provider_balances' }, async () => {
    const saldos = await leerSaldosDeProveedores();
    return { saldos, enRojo: cuantosEnRojo(saldos) };
  });
}
