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
 *   - Fallo de verificación: conserva la identidad y el contexto actuales,
 *     sin escritura alternativa ni contenido privado en logs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { UUID } from '@/lib/inbox/collaboration';

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
  // Sin comodines. Este valor va directo a un `ilike`, donde `%` y `_` NO son
  // literales: un contacto con el correo `%@%.%` hacía que la búsqueda de
  // duplicados matcheara a TODOS los del comercio y los fusionara a todos en
  // una sola ficha, sin vuelta atrás. Un correo real no los lleva, así que
  // descartarlo no pierde nada.
  if (/[%_]/.test(trimmed)) return null;
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
  if (!UUID.test(contact.id) || !UUID.test(contact.workspace_id)) return contact.id;
  try {
    const { data, error } = await db.rpc('link_verified_contact', { p_workspace_id: contact.workspace_id, p_contact_id: contact.id });
    if (error || typeof data !== 'string' || !UUID.test(data)) return contact.id;
    return data;
  } catch { return contact.id; }
}

/**
 * Lee el primario desde la identidad persistida y la familia verificada.
 * No confía en un vínculo del objeto recibido; ante dudas conserva el actual.
 */
export async function loadPrimaryContact(
  db: SupabaseClient,
  contact: Contact,
): Promise<Contact> {
  if (!UUID.test(contact.id) || !UUID.test(contact.workspace_id)) return contact;
  try {
    // One database snapshot checks persisted linkage, separation and both identities.
    const { data, error } = await db.rpc('read_verified_primary_contact', { p_workspace_id: contact.workspace_id, p_contact_id: contact.id });
    if (error || !data || typeof data !== 'object' || typeof data.id !== 'string' || !UUID.test(data.id)
      || data.id === contact.id || data.workspace_id !== contact.workspace_id || data.unified_contact_id != null || data.union_bloqueada) return contact;
    return data as Contact;
  } catch { return contact; }
}
