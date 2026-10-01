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
import {
  hayContradiccion,
  identificadoresParaUnir,
} from './identidad-probada';

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
  try {
    // Con que se puede unir y con que no.
    //
    // No alcanza con que el dato exista: tiene que estar RESPALDADO (migracion
    // 206). Un correo que un anonimo tipeo en un chat no une a nadie -- unir
    // sobre eso es una toma de cuenta en dos pasos: pongo el correo de otra
    // clienta y me quedo con su ficha, sus pedidos y su direccion.
    //
    // Tampoco unen las casillas de rol (info@, ventas@) ni los telefonos de
    // relleno: aparecen en decenas de fichas distintas y funden a todo el
    // mundo en una sola, sin vuelta atras.
    const usable = identificadoresParaUnir(contact);
    const phoneNorm = normalizePhone(usable.phone);
    const emailNorm = normalizeEmail(usable.email);
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

    // ANTE LA DUDA, NO SE UNE.
    //
    // Dos frenos, y los dos son casos reales:
    //
    // 1. Un candidato que alguien ya separo a mano. Una persona miro esas dos
    //    fichas y dijo que no son el mismo cliente; ninguna coincidencia de
    //    telefono le gana a eso.
    // 2. Candidatos que se contradicen: mismo celular y correos distintos es
    //    un telefono de familia, no una persona. Unir de mas le muestra a
    //    alguien la direccion y los pedidos de otro; unir de menos solo hace
    //    que el agente pregunte algo que ya sabia. No son igual de graves.
    const separadoAMano = candidates.some(
      (c) => (c as Contact & { union_bloqueada?: boolean | null }).union_bloqueada,
    );
    if (separadoAMano) return contact.id;
    if (hayContradiccion([contact, ...candidates])) return contact.id;

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
  if (!contact.unified_contact_id || !contact.workspace_id || contact.unified_contact_id === contact.id) return contact;
  try {
    const { data,error } = await db
      .from('contacts')
      .select('*')
      .eq('workspace_id',contact.workspace_id)
      .eq('id',contact.unified_contact_id)
      .maybeSingle();
    if (error || !data || data.workspace_id !== contact.workspace_id || data.id !== contact.unified_contact_id) return contact;
    return data as Contact;
  } catch { return contact; }
}
