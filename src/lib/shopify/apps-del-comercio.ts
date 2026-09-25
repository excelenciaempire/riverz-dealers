import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { verifyOAuthHmac } from './oauth';

/**
 * Las apps de Shopify que pueden instalar Riverz en una tienda.
 *
 * Dos viven en variables de entorno: la pública y la heredada ("Riverz
 * Inbox"). Las demás son de un comercio (migración 275): una app con
 * distribución personalizada que Riverz crea para esa tienda, o la que el
 * comercio crea en su propia organización. Shopify no dice cuál app instaló;
 * lo dice la firma, que sólo valida con el secreto de esa app.
 */
export interface AppDeShopify {
  apiKey: string;
  apiSecret: string;
  /** Sólo las del comercio: el workspace al que va la tienda y quién la registró. */
  destino: { workspaceId: string; userId: string } | null;
}

export function appsGlobales(): AppDeShopify[] {
  return [
    {
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecret: process.env.SHOPIFY_API_SECRET,
    },
    {
      apiKey: process.env.SHOPIFY_API_KEY_LEGACY,
      apiSecret: process.env.SHOPIFY_API_SECRET_LEGACY,
    },
  ]
    .filter((p): p is { apiKey: string; apiSecret: string } =>
      Boolean(p.apiKey && p.apiSecret)
    )
    .map((p) => ({ ...p, destino: null }));
}

/** Las registradas para esta tienda, la más reciente primero. */
export async function appsDelComercio(
  db: SupabaseClient,
  shop: string
): Promise<AppDeShopify[]> {
  const { data, error } = await db
    .from('shopify_custom_apps')
    .select('client_id, client_secret_encrypted, workspace_id, user_id')
    .eq('shop_domain', shop)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`shopify_custom_apps: ${error.message}`);
  const apps: AppDeShopify[] = [];
  for (const fila of data ?? []) {
    try {
      apps.push({
        apiKey: fila.client_id,
        apiSecret: decrypt(fila.client_secret_encrypted),
        destino: { workspaceId: fila.workspace_id, userId: fila.user_id },
      });
    } catch {
      // Un secreto que no se descifra no firma nada: se ignora.
    }
  }
  return apps;
}

/** Todas las que pueden haber firmado por esta tienda. */
export async function appsParaLaTienda(
  db: SupabaseClient,
  shop: string
): Promise<AppDeShopify[]> {
  const delComercio = await appsDelComercio(db, shop).catch(() => []);
  return [...delComercio, ...appsGlobales()];
}

/** La app cuyo secreto valida la firma de esta consulta de Shopify. */
export function appQueFirmo(
  apps: AppDeShopify[],
  params: URLSearchParams
): AppDeShopify | null {
  return apps.find((a) => verifyOAuthHmac(params, a.apiSecret)) ?? null;
}

/**
 * Guarda la app de un comercio hasta que el dueño la instale.
 *
 * Volver a registrarla en el mismo workspace reemplaza el secreto: es lo que
 * pasa después de rotarlo en Shopify.
 */
export async function registrarAppDelComercio(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    userId: string;
    shopDomain: string;
    clientId: string;
    clientSecret: string;
  }
): Promise<void> {
  const { error } = await db.from('shopify_custom_apps').upsert(
    {
      workspace_id: args.workspaceId,
      user_id: args.userId,
      shop_domain: args.shopDomain,
      client_id: args.clientId,
      client_secret_encrypted: encrypt(args.clientSecret),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,client_id' }
  );
  if (error) throw new Error(`shopify_custom_apps: ${error.message}`);
}

/** La tienda de este workspace que espera que instalen su app, si hay una. */
export async function tiendaEsperandoInstalacion(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data } = await db
    .from('shopify_custom_apps')
    .select('shop_domain')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.shop_domain as string | undefined) ?? null;
}
