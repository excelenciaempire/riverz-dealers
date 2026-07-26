import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { enrichContactFromShopify } from '@/lib/contacts/enrich';

/**
 * Qué sabemos COMERCIALMENTE de esta persona antes de escribirle.
 *
 * El Asistente ya lo cargaba (historial de Shopify + notas) para responder a
 * quien escribe, pero los mensajes PROACTIVOS —el piso de comentarios y las
 * campañas— salían ciegos: le vendían igual a una desconocida que a una clienta
 * que compró la semana pasada, y a quien preguntaba por su pedido bajo un post
 * le respondían con un pitch. Mismo negocio, misma persona, dos memorias
 * distintas.
 *
 * Devuelve un resumen corto para el prompt (o null si no hay nada que decir).
 * Best-effort: cualquier fallo se traga y el DM sale como antes.
 */
export interface CustomerContext {
  /** Resumen para el prompt. */
  brief: string;
  /** ¿Ya compró alguna vez? Cambia el encargo del mensaje. */
  isCustomer: boolean;
}

export async function loadCustomerContext(
  db: SupabaseClient,
  contactId: string,
): Promise<CustomerContext | null> {
  try {
    const { data } = await db
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .maybeSingle();
    const contact = data as Contact | null;
    if (!contact) return null;

    const snap = await enrichContactFromShopify(db, contact).catch(() => null);
    if (!snap) return null;

    const orders = Number(snap.orders_count ?? 0);
    if (orders <= 0) return null;

    const lines: string[] = [`Ya te compró ${orders} ${orders === 1 ? 'vez' : 'veces'}.`];
    const last = snap.lifetime_orders?.[0];
    if (last?.line_items_titles?.length) {
      lines.push(`Lo último que se llevó: ${last.line_items_titles.slice(0, 3).join(', ')}.`);
    }
    if (snap.last_order_date) {
      lines.push(`Su última compra: ${snap.last_order_date.slice(0, 10)}.`);
    }

    return {
      isCustomer: true,
      brief: `CLIENTA/CLIENTE QUE YA COMPRÓ (no le hables como a alguien que no te conoce):\n- ${lines.join('\n- ')}`,
    };
  } catch {
    return null;
  }
}
