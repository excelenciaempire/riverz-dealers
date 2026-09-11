import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { publicBaseUrl } from "@/lib/base-url";
import { getLogger } from "@/lib/log/logger";
import { ShopifyAdminClient, ShopifyUnauthorizedError } from "@/lib/shopify/admin-client";
import { tokenVivo, COLUMNAS_TOKEN } from "@/lib/shopify/token-vivo";
import { selectAll } from "@/lib/db/paginate";
import { TiendanubeClient } from "./providers/tiendanube";
import { WooCommerceClient } from "./providers/woocommerce";
import type { CommercePlatform } from "./types";

const log = getLogger("commerce.webhook-reconcile");

/**
 * Deja los webhooks de cada tienda apuntando al dominio actual.
 *
 * Las tres plataformas comparten el mismo agujero: la URL se registra UNA VEZ,
 * al conectar, y nadie la vuelve a mirar. Cuando el servicio cambia de dominio
 * —una mudanza de hosting, un dominio propio— la tienda sigue entregando cada
 * pedido y cada carrito abandonado a un servidor que ya no existe. No falla
 * nada: simplemente dejan de llegar pedidos, y el comercio no tiene forma de
 * verlo desde Riverz.
 *
 * Por eso repara en vez de sólo avisar: un aviso en un panel que nadie mira no
 * devuelve los pedidos perdidos. Es el mismo criterio que
 * `meta-webhook-subscriptions` aplica a las suscripciones de Meta.
 *
 * Sólo toca webhooks cuya RUTA es nuestra: una tienda puede tener instaladas
 * otras aplicaciones y los webhooks de ellas no son nuestros para borrarlos.
 */
export interface StoreReconcileResult {
  id: string;
  platform: CommercePlatform;
  shopDomain: string;
  deleted: number;
  created: number;
  kept: number;
  error?: string;
}

type StoreRow = Parameters<typeof tokenVivo>[1] & {
  id: string;
  platform: CommercePlatform | null;
  shop_domain: string;
  external_store_id: string | null;
  access_token: string;
  api_secret: string | null;
  webhook_secret: string | null;
  status: string;
};

export async function reconcileAllCommerceWebhooks(db: SupabaseClient): Promise<{
  stores: number;
  repaired: number;
  results: StoreReconcileResult[];
}> {
  const base = publicBaseUrl();
  const rows = await selectAll<StoreRow>(db, "shopify_connections",
    query => query.in("status", ["active", "expired", "error"]), {
      select: `${COLUMNAS_TOKEN}, platform, external_store_id, api_secret, status`,
      strict: true,
    });

  const results: StoreReconcileResult[] = [];
  for (const row of rows) {
    const platform = (row.platform ?? "shopify") as CommercePlatform;
    const result: StoreReconcileResult = {
      id: row.id,
      platform,
      shopDomain: row.shop_domain,
      deleted: 0,
      created: 0,
      kept: 0,
    };
    try {
      Object.assign(result, await reconcileOne(db, row, platform, base));
      if (row.status !== "active") {
        const { error } = await db.from("shopify_connections")
          .update({ status: "active", last_error: null }).eq("id", row.id)
          .in("status", ["expired", "error"]);
        if (error) throw new Error(`webhook recovery persistence: ${error.message}`);
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      log.warn("no se pudo reconciliar los webhooks de la tienda", {
        shopDomain: row.shop_domain,
        platform,
        error: result.error,
      });
      // La tienda rechazó nuestra credencial: no es un tropiezo de red, es una
      // conexión muerta. Se marca para que deje de reintentar cada seis horas
      // contra algo que sólo se arregla volviendo a conectar, y para que la
      // interfaz lo diga en vez de mostrarla "activa" para siempre.
      // (Caso real: Shopify dejó de aceptar los tokens que no expiran.)
      if (platform === "shopify"
        ? err instanceof ShopifyUnauthorizedError
        : /\b401\b/.test(result.error)) {
        // `expired` y no un estado nuevo: la columna tiene un CHECK con
        // ('active','uninstalled','expired','error') y un valor fuera de esa
        // lista hace fallar el UPDATE. Escribir 'revoked' fallaba en silencio
        // —el error se ignoraba— y la conexión seguía marcada activa,
        // reintentando cada seis horas contra un token que la tienda ya no
        // acepta. Justo el modo de falla que este archivo trata de evitar.
        const { error: markErr } = await db
          .from("shopify_connections")
          .update({ status: "expired" })
          .eq("id", row.id);
        if (markErr) {
          log.warn("no se pudo marcar la conexión como vencida", {
            shopDomain: row.shop_domain,
            error: markErr.message,
          });
        }
      }
    }
    results.push(result);
  }

  const repaired = results.filter((r) => r.deleted > 0 || r.created > 0).length;
  if (repaired > 0) {
    log.warn("webhooks de tienda repuntados al dominio actual", {
      base,
      stores: results.filter((r) => r.deleted > 0 || r.created > 0),
    });
  }
  return { stores: rows.length, repaired, results };
}

async function reconcileOne(
  db: SupabaseClient,
  row: StoreRow,
  platform: CommercePlatform,
  base: string,
): Promise<{ deleted: number; created: number; kept: number }> {
  if (platform === "shopify") {
    const { accessToken } = await tokenVivo(db, row);
    return new ShopifyAdminClient(row.shop_domain, accessToken).reconcileWebhooks(base);
  }

  const token = decrypt(row.access_token);

  if (platform === "tiendanube") {
    if (!row.external_store_id) throw new Error("tiendanube sin external_store_id");
    return new TiendanubeClient(
      row.external_store_id,
      token,
      row.shop_domain,
    ).reconcileWebhooks(base);
  }

  if (platform === "woocommerce") {
    // WooCommerce no expone un conteo: `registerWebhooks` ya borra TODO lo que
    // apunte a nuestra ruta (cualquier dominio) y vuelve a dar de alta los
    // cuatro temas, así que llamarlo ES la reconciliación. El secreto de firma
    // lo elegimos nosotros y hay que conservarlo: regenerarlo invalidaría las
    // entregas en vuelo.
    if (!row.api_secret) throw new Error("woocommerce sin api_secret");
    if (!row.webhook_secret) throw new Error("woocommerce sin webhook_secret");
    const client = new WooCommerceClient(
      row.shop_domain,
      token,
      decrypt(row.api_secret),
    );
    await client.registerWebhooks(base, decrypt(row.webhook_secret));
    return { deleted: 0, created: 4, kept: 0 };
  }

  throw new Error(`plataforma sin reconciliador: ${platform}`);
}
