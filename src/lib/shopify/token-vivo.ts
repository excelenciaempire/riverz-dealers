import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import {
  exchangeClientCredentialsForToken,
  refreshShopifyToken,
} from './oauth';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('shopify.token');

/**
 * El token de una tienda, vivo.
 *
 * Shopify dio de baja los tokens que no expiran: los nuevos duran una hora y
 * traen un `refresh_token` que vale noventa días (migración 194). Renovarlos es
 * cosa del servidor — el comercio conecta una vez y no vuelve a ver una
 * pantalla.
 *
 * Esta función es el único lugar por el que debería salir un token de la base.
 * Puesta acá y no en cada llamador porque los llamadores son muchos y no se
 * conocen entre sí: el runner del agente, los crons, los webhooks, la
 * sincronización de catálogo. Con la renovación repartida, alcanza con que uno
 * se olvide para que esa tienda se caiga sola una hora después de conectarse.
 */

/**
 * Cuánto antes de vencer se renueva.
 *
 * Cinco minutos, no cero: entre que se lee la fila y que Shopify contesta pasa
 * tiempo, y un token que vence a mitad de una sincronización de catálogo deja
 * la mitad de los productos adentro y la mitad afuera.
 */
const MARGEN_MS = 5 * 60 * 1000;

export interface TokenVivo {
  accessToken: string;
  /** True si hubo que renovarlo en esta llamada. */
  renovado: boolean;
}

interface FilaConexion {
  id: string;
  shop_domain: string;
  access_token: string;
  token_expires_at: string | null;
  refresh_token_encrypted: string | null;
  refresh_token_expires_at: string | null;
  connection_method: 'oauth' | 'admin_token' | 'client_credentials' | null;
  client_id_encrypted: string | null;
  webhook_secret: string | null;
}

/** ¿Hay que renovarlo antes de usarlo? */
export function venceProximo(
  expiraEn: string | null,
  ahora = Date.now()
): boolean {
  // Sin fecha es un token de los viejos, que no expira. Siguen andando hasta
  // que Shopify también los corte; forzar una renovación que no tienen cómo
  // hacer los rompería antes de tiempo.
  if (!expiraEn) return false;
  const t = Date.parse(expiraEn);
  return Number.isFinite(t) ? t - ahora <= MARGEN_MS : false;
}

/**
 * Devuelve el token usable de esa conexión, renovándolo si hace falta.
 *
 * Nunca lanza por un fallo de renovación: devuelve el token viejo y deja el
 * motivo anotado. Que Shopify conteste 401 y el llamador lo maneje es mejor que
 * cortar una respuesta a un cliente por un refresh que no salió.
 */
export async function tokenVivo(
  db: SupabaseClient,
  fila: FilaConexion
): Promise<TokenVivo> {
  const actual = decrypt(fila.access_token);
  if (!venceProximo(fila.token_expires_at)) {
    return { accessToken: actual, renovado: false };
  }

  if (fila.connection_method === 'client_credentials') {
    if (!fila.client_id_encrypted || !fila.webhook_secret) {
      return { accessToken: actual, renovado: false };
    }
    try {
      const nuevo = await exchangeClientCredentialsForToken({
        shop: fila.shop_domain,
        clientId: decrypt(fila.client_id_encrypted),
        clientSecret: decrypt(fila.webhook_secret),
      });
      await db
        .from('shopify_connections')
        .update({
          access_token: encrypt(nuevo.access_token),
          token_expires_at: nuevo.expires_in
            ? new Date(Date.now() + nuevo.expires_in * 1000).toISOString()
            : null,
          status: 'active',
          last_error: null,
        })
        .eq('id', fila.id);
      return { accessToken: nuevo.access_token, renovado: true };
    } catch (err) {
      log.warn('client_credentials_refresh_failed', {
        shop: fila.shop_domain,
        error: err instanceof Error ? err.message : String(err),
      });
      await db
        .from('shopify_connections')
        .update({
          last_error: `No se pudo renovar el acceso: ${
            err instanceof Error ? err.message.slice(0, 160) : 'error'
          }`,
        })
        .eq('id', fila.id);
      return { accessToken: actual, renovado: false };
    }
  }

  // Las dos apps, como en el callback: la principal y la de distribución
  // heredada. Una tienda conectada por la segunda no se renueva con el secreto
  // de la primera, y el error sería indistinguible de un refresh vencido.
  const pares = [
    {
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecret: process.env.SHOPIFY_API_SECRET,
    },
    {
      apiKey: process.env.SHOPIFY_API_KEY_LEGACY,
      apiSecret: process.env.SHOPIFY_API_SECRET_LEGACY,
    },
  ].filter((p): p is { apiKey: string; apiSecret: string } =>
    Boolean(p.apiKey && p.apiSecret)
  );

  if (!fila.refresh_token_encrypted || pares.length === 0) {
    // Vencido y sin con qué renovar: reconectar es lo único que queda, y quien
    // llame se va a encontrar con un 401 que ya marca la conexión.
    return { accessToken: actual, renovado: false };
  }

  try {
    const refresh = decrypt(fila.refresh_token_encrypted);
    let nuevo: Awaited<ReturnType<typeof refreshShopifyToken>> | null = null;
    let ultimoError: unknown = null;
    for (const par of pares) {
      try {
        nuevo = await refreshShopifyToken({
          shop: fila.shop_domain,
          refreshToken: refresh,
          apiKey: par.apiKey,
          apiSecret: par.apiSecret,
        });
        break;
      } catch (e) {
        ultimoError = e;
      }
    }
    if (!nuevo) throw ultimoError ?? new Error('refresh sin resultado');

    // Shopify devuelve un refresh NUEVO en cada renovación. Guardar sólo el
    // access y quedarse con el refresh viejo funciona una vez y a la siguiente
    // deja la tienda afuera, sin que nadie haya tocado nada.
    const parche: Record<string, unknown> = {
      access_token: encrypt(nuevo.access_token),
      token_expires_at: nuevo.expires_in
        ? new Date(Date.now() + nuevo.expires_in * 1000).toISOString()
        : null,
      status: 'active',
      last_error: null,
    };
    // Los permisos del token NUEVO, que no tienen por qué ser los del viejo.
    //
    // Shopify emite cada renovación contra la configuración ACTUAL de la app,
    // así que un permiso que estaba en el otorgamiento original puede no venir
    // en el siguiente token — y la columna se quedaba diciendo que sí. Medido
    // el 2026-08-25 sobre la tienda demo: la columna afirmaba
    // `write_order_edits` y `/admin/oauth/access_scopes.json` decía que no.
    // Una columna que miente sobre permisos es peor que una vacía: es con la
    // que se decide si hay que pedirle al comercio que reconecte.
    if (nuevo.scope) parche.scope = nuevo.scope;
    if (nuevo.refresh_token) {
      parche.refresh_token_encrypted = encrypt(nuevo.refresh_token);
      parche.refresh_token_expires_at = nuevo.refresh_token_expires_in
        ? new Date(
            Date.now() + nuevo.refresh_token_expires_in * 1000
          ).toISOString()
        : null;
    }
    await db.from('shopify_connections').update(parche).eq('id', fila.id);

    return { accessToken: nuevo.access_token, renovado: true };
  } catch (err) {
    log.warn('refresh_failed', {
      shop: fila.shop_domain,
      error: err instanceof Error ? err.message : String(err),
    });
    await db
      .from('shopify_connections')
      .update({
        last_error: `No se pudo renovar el acceso: ${
          err instanceof Error ? err.message.slice(0, 160) : 'error'
        }`,
      })
      .eq('id', fila.id);
    return { accessToken: actual, renovado: false };
  }
}

/** Las columnas que `tokenVivo` necesita. Para no repetir la lista en cada
 *  `select` y que a uno se le olvide una y la renovación deje de ocurrir. */
export const COLUMNAS_TOKEN =
  'id, shop_domain, access_token, token_expires_at, refresh_token_encrypted, refresh_token_expires_at, connection_method, client_id_encrypted, webhook_secret';
