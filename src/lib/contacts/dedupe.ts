/**
 * Cross-channel contact dedupe.
 *
 * Cuando un webhook ingesta un contact nuevo, miramos si dentro del
 * MISMO workspace hay otro contact con el mismo teléfono normalizado
 * (E.164) o el mismo email (case-insensitive). Si lo hay, populamos el
 * campo `unified_contact_id` apuntando al "primario" — el contact más
 * viejo del grupo. Migration 050.
 *
 * El runner de IA hace `loadUnifiedContact()` para leer los datos
 * agregados (ai_summary + shopify_customer_data + historial) tanto del
 * primario como del registro actual, y los inyecta combinados en el
 * system prompt.
 *
 * Diseño:
 *   - El primario es siempre el contact con `created_at` más viejo en
 *     el grupo. Si después aparece uno todavía más viejo (por una
 *     migración o reprocesamiento), el nuevo dedupe reapunta a él.
 *   - Nunca borramos filas — sólo enlazamos. Cada canal sigue siendo
 *     direccionable individualmente (necesario para responder por el
 *     canal exacto que el cliente usó).
 *   - Fail-soft: cualquier error de lectura/escritura se loguea y
 *     swallowea. Es una mejora opcional, no debe romper el ingest.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';

/** Convierte un teléfono a E.164 estricto (best-effort) — sólo dígitos,
 *  con prefijo `+`. Si tiene < 8 dígitos lo dejamos como vino (no es un
 *  teléfono confiable, no sirve para deduplicar). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 8) return null;
  return '+' + digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes('@')) return null;
  return trimmed;
}

/**
 * Busca y enlaza el contact dado contra cualquier otro del mismo
 * workspace que comparta teléfono normalizado o email. Setea
 * `unified_contact_id` si encuentra match (o desempata por antigüedad).
 *
 * Devuelve el id del primario (puede ser el propio `contact.id` si
 * resulta ser el más viejo del grupo).
 */
export async function linkUnifiedContact(
  db: SupabaseClient,
  contact: Contact,
): Promise<string> {
  try {
    const phoneNorm = normalizePhone(contact.phone ?? null);
    const emailNorm = normalizeEmail(contact.email ?? null);
    if (!phoneNorm && !emailNorm) return contact.id;

    // Buscamos cualquier contact del mismo workspace que matchee.
    // Usamos los índices funcionales lower(phone)/lower(email) — son
    // O(log n) sobre 100k+ contactos.
    const candidates: Contact[] = [];
    if (phoneNorm) {
      const { data: byPhone } = await db
        .from('contacts')
        .select('*')
        .eq('workspace_id', contact.workspace_id)
        .ilike('phone', phoneNorm)
        .neq('id', contact.id);
      candidates.push(...((byPhone as Contact[] | null) ?? []));
    }
    if (emailNorm) {
      const { data: byEmail } = await db
        .from('contacts')
        .select('*')
        .eq('workspace_id', contact.workspace_id)
        .ilike('email', emailNorm)
        .neq('id', contact.id);
      candidates.push(...((byEmail as Contact[] | null) ?? []));
    }
    if (candidates.length === 0) return contact.id;

    // El primario es el más viejo del grupo (incluido el actual).
    const all = [contact, ...candidates];
    all.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });
    const primary = all[0];

    // Actualizamos a TODOS los que NO sean el primario para que apunten
    // a él (idempotente — si ya apuntaban está bien).
    const toLink = all
      .filter((c) => c.id !== primary.id)
      .map((c) => c.id);
    if (toLink.length > 0) {
      await db
        .from('contacts')
        .update({ unified_contact_id: primary.id })
        .in('id', toLink);
    }
    // El primario en sí debe tener unified_contact_id = NULL (no se
    // apunta a sí mismo). Si por una merge anterior tenía algo, lo
    // limpiamos.
    if (primary.unified_contact_id) {
      await db
        .from('contacts')
        .update({ unified_contact_id: null })
        .eq('id', primary.id);
    }
    return primary.id;
  } catch (err) {
    console.error('[contacts/dedupe] linkUnifiedContact failed:', err);
    return contact.id;
  }
}

/**
 * Carga el contact "primario" para un contact dado. Si `contact` no
 * tiene `unified_contact_id`, devuelve el mismo contact tal cual. Si lo
 * tiene, intenta cargar el primario; si falla (FK rota o nada), cae al
 * contact original.
 */
export async function loadPrimaryContact(
  db: SupabaseClient,
  contact: Contact,
): Promise<Contact> {
  if (!contact.unified_contact_id) return contact;
  const { data } = await db
    .from('contacts')
    .select('*')
    .eq('id', contact.unified_contact_id)
    .maybeSingle();
  return ((data as Contact | null) ?? contact);
}
