import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { enrichContactFromShopify } from './enrich';
import { applyCategoryTags } from './tags';

/**
 * Mantener la ficha de TODOS los contactos completa y clasificada.
 *
 * El enriquecimiento desde Shopify existía desde hacía tiempo, pero sólo se
 * disparaba cuando el agente de IA atendía un mensaje: sobre 2.844 contactos
 * se había intentado 3 veces y ninguno tenía datos, aunque 1.881 estaban
 * marcados como compradores. Es decir, la información estaba en Shopify y la
 * bandeja no la mostraba nunca.
 *
 * Este módulo la va a buscar por lotes, de forma continua:
 *
 *   - Primero los que NUNCA se intentaron (un contacto nuevo entra completo
 *     en la corrida siguiente, no cuando alguien le escriba).
 *   - Después los más viejos, para que nada quede congelado: una dirección
 *     que cambió en Shopify se corrige sola.
 *
 * Y en la misma pasada reclasifica: las etiquetas (comprador, comprador-
 * recurrente, oferta, unidades) se derivan de los datos que se acaban de
 * traer, así la categoría nunca contradice a la ficha.
 */

/** Contactos por corrida. 45 × ~2 llamadas ≈ 90 pedidos a Shopify, cómodo
 *  dentro del bucket de 40 en ráfaga + 2/s sostenidos que permite su API. */
const BATCH = 45;
/** Cuántos en paralelo. Bajo a propósito: pasarse de los 2/s de Shopify
 *  devuelve 429 y perderíamos el lote entero. */
const CONCURRENCY = 3;
/** Cada cuánto se vuelve a preguntar por un contacto ya sincronizado. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface SyncAllResult {
  /** Contactos procesados en esta corrida. */
  processed: number;
  /** Cuántos resultaron ser clientes de Shopify (con datos). */
  matched: number;
  /** Cuántos quedaron reclasificados con etiquetas. */
  tagged: number;
  /** Cuántos quedan pendientes por sincronizar (0 = base al día). */
  pending: number;
}

/**
 * Procesa un lote de contactos pendientes de TODOS los workspaces que tengan
 * Shopify conectado.
 */
export async function syncContactsBatch(db: SupabaseClient): Promise<SyncAllResult> {
  const staleBefore = new Date(Date.now() - REFRESH_AFTER_MS).toISOString();

  // Los nunca intentados primero (nullsFirst), después los más viejos. Así un
  // contacto nuevo se completa en la corrida siguiente y el resto rota.
  const { data: rows } = await db
    .from('contacts')
    .select('*')
    .or(`shopify_data_synced_at.is.null,shopify_data_synced_at.lt.${staleBefore}`)
    .order('shopify_data_synced_at', { ascending: true, nullsFirst: true })
    .limit(BATCH);
  const contacts = (rows ?? []) as Contact[];

  let matched = 0;
  let tagged = 0;
  const tagCache = new Map<string, string>();

  await mapWithConcurrency(contacts, CONCURRENCY, async (contact) => {
    try {
      const snapshot = await enrichContactFromShopify(db, contact);
      if (!snapshot) return;
      matched++;
      // Reclasificar con lo que acaba de llegar. `last_offer_*` los sella el
      // webhook de pedidos; acá sólo se usan para elegir la etiqueta.
      const ordersCount = Number(snapshot.orders_count ?? 0) || 0;
      await applyCategoryTags(
        db,
        contact.workspace_id,
        contact.id,
        {
          ordersCount,
          // El carrito abandonado lo marca su propio flujo — desde Shopify no
          // se distingue, y pisarlo acá borraría un dato que sí es cierto.
          isAbandoned: false,
          offerLabel: contact.last_offer_chosen ?? null,
          units: contact.last_offer_units ?? null,
        },
        tagCache,
      );
      tagged++;
    } catch (err) {
      // Un contacto que falla no puede cortar el lote: su `synced_at` queda
      // como estaba y vuelve a entrar en la próxima corrida.
      console.error('[contacts/sync-all] contacto falló:', contact.id, err);
    }
  });

  const { count } = await db
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .or(`shopify_data_synced_at.is.null,shopify_data_synced_at.lt.${staleBefore}`);

  return {
    processed: contacts.length,
    matched,
    tagged,
    pending: Math.max(0, (count ?? 0) - contacts.length),
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}
