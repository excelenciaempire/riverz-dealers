import { adminGet } from '@/lib/admin/route';
import { leerProveedores, type EstadoDeProveedores } from '@/lib/admin/proveedores';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/proveedores — saldo, estado y costo fijo, en una sola ronda.
 *
 * Reemplaza a `/api/admin/saldos` y `/api/admin/infrastructure`, que sondeaban
 * los mismos cinco proveedores por separado.
 *
 * **La caché no es una optimización: es plata.** Varias de estas sondas son
 * completions facturables (Anthropic, Cerebras, Groq, OpenAI). Sin esto, dos
 * pestañas abiertas eran dos rondas pagas cada vez, y la ruta vieja de saldos
 * ni siquiera tenía caché aunque su comentario dijera que no se refrescaba
 * sola.
 *
 * `enVuelo` es el otro medio: dos pedidos simultáneos comparten la misma ronda
 * en vez de disparar dos.
 */
const TTL_MS = 55_000;

let cache: { at: number; data: EstadoDeProveedores } | null = null;
let enVuelo: Promise<EstadoDeProveedores> | null = null;

async function leerConCache(): Promise<EstadoDeProveedores> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (enVuelo) return enVuelo;

  enVuelo = leerProveedores()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      enVuelo = null;
    });

  return enVuelo;
}

export async function GET(request: Request) {
  return adminGet(request, { action: 'view.provider_balances' }, leerConCache);
}
