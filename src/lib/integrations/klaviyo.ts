/**
 * Klaviyo — la base de contactos de Riverz, espejada en la audiencia propia
 * del comercio.
 *
 * Antes esto sólo empujaba el correo que capturaba el agente de Instagram: un
 * caso de borde. Lo que un comercio con Klaviyo espera es lo contrario — que
 * TODA la gente que entra por Riverz (WhatsApp, Instagram, Messenger, correo,
 * Mercado Libre, Shopify) aparezca en su lista, con lo que sabemos de ella, y
 * que quien se da de baja deje de recibir.
 *
 * Cómo:
 *  - Alta/actualización en lotes con el "bulk profile import" de Klaviyo (un
 *    pedido por cada 1.000 personas, no uno por persona).
 *  - Los activos entran además a una lista llamada "Riverz", que es lo que el
 *    comercio segmenta y usa como disparador en sus flujos.
 *  - Las bajas se suprimen por correo y quedan marcadas con la propiedad
 *    `riverz_opted_out`. Riverz no inventa consentimiento: nunca suscribe a
 *    nadie, sólo crea/actualiza el perfil y deja que el comercio decida.
 *
 * Klaviyo exige al menos un identificador (correo o teléfono E.164) por
 * perfil; quien no tenga ninguno se saltea en vez de romper el lote entero.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { chunk, fetchAllRows } from '@/lib/supabase/paginate';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
/** Versión de la API. Klaviyo la exige en cada pedido y la fija por fecha. */
export const KLAVIYO_REVISION = '2024-10-15';

/** Nombre de la lista que Riverz mantiene en la cuenta del comercio. */
const LIST_NAME = 'Riverz';

/** Tope del import masivo de Klaviyo. */
const IMPORT_CHUNK = 1000;
/** Tope por corrida y por workspace, para que una cuenta grande no monopolice el tick. */
const MAX_CONTACTS_PER_RUN = 10_000;

export async function klaviyoFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${KLAVIYO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Id de la lista "Riverz" en la cuenta del comercio; la crea si no está.
 * Devuelve null si Klaviyo no coopera — el import igual corre, sólo que los
 * perfiles quedan en la cuenta sin entrar a la lista.
 */
export async function ensureRiverzList(apiKey: string): Promise<string | null> {
  try {
    const filter = encodeURIComponent(`equals(name,"${LIST_NAME}")`);
    const res = await klaviyoFetch(apiKey, `/lists/?filter=${filter}`);
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const found = json.data?.[0]?.id;
      if (found) return found;
    }
    const created = await klaviyoFetch(apiKey, '/lists/', {
      method: 'POST',
      body: JSON.stringify({
        data: { type: 'list', attributes: { name: LIST_NAME } },
      }),
    });
    if (!created.ok) return null;
    const json = (await created.json()) as { data?: { id?: string } };
    return json.data?.id ?? null;
  } catch {
    return null;
  }
}

/** Teléfono en E.164 o null: Klaviyo rechaza cualquier otro formato. */
function toE164(phone?: string | null): string | null {
  const digits = sanitizePhoneForMeta(phone ?? '');
  if (!digits) return null;
  const e164 = `+${digits}`;
  return isValidE164(e164) ? e164 : null;
}

interface KlaviyoProfile {
  type: 'profile';
  attributes: Record<string, unknown>;
}

/**
 * Contacto de Riverz → perfil de Klaviyo. Las propiedades van con prefijo
 * `riverz_` para que en el segmentador del comercio se vea de dónde salen y no
 * pisen las suyas.
 */
export function toKlaviyoProfile(
  contact: Contact,
  tags: string[],
): KlaviyoProfile | null {
  const email = contact.email?.trim() || null;
  const phone = toE164(contact.phone);
  if (!email && !phone) return null;

  const attributes: Record<string, unknown> = {};
  if (email) attributes.email = email;
  if (phone) attributes.phone_number = phone;

  const full = (contact.name ?? '').trim();
  if (full) {
    const [first, ...rest] = full.split(/\s+/);
    attributes.first_name = first;
    if (rest.length) attributes.last_name = rest.join(' ');
  }
  if (contact.company) attributes.organization = contact.company;

  const shop = contact.shopify_customer_data as
    | (Record<string, unknown> & { default_address?: Record<string, unknown> })
    | null
    | undefined;
  const addr = (shop?.default_address ?? shop?.address) as
    | Record<string, unknown>
    | undefined;
  if (addr) {
    const location: Record<string, unknown> = {};
    if (addr.city) location.city = String(addr.city);
    if (addr.province) location.region = String(addr.province);
    if (addr.country) location.country = String(addr.country);
    if (addr.zip) location.zip = String(addr.zip);
    if (Object.keys(location).length) attributes.location = location;
  }

  const properties: Record<string, unknown> = {
    riverz_channel: contact.channel,
    riverz_contact_id: contact.id,
  };
  if (tags.length) properties.riverz_tags = tags;
  if (contact.is_shopify_customer) properties.riverz_shopify_customer = true;
  if (contact.last_offer_chosen) properties.riverz_last_offer = contact.last_offer_chosen;
  if (contact.last_offer_units != null) properties.riverz_last_units = contact.last_offer_units;
  const spent = Number(shop?.total_spent ?? shop?.totalSpent);
  if (Number.isFinite(spent)) properties.riverz_total_spent = spent;
  const orders = Number(shop?.orders_count ?? shop?.ordersCount);
  if (Number.isFinite(orders)) properties.riverz_orders_count = orders;
  const optedOut = (contact as unknown as { opted_out?: boolean }).opted_out === true;
  if (optedOut) properties.riverz_opted_out = true;
  attributes.properties = properties;

  return { type: 'profile', attributes };
}

/** Alta/actualización en lote. `listId` null = sin sumar a la lista. */
async function importProfiles(
  apiKey: string,
  profiles: KlaviyoProfile[],
  listId: string | null,
): Promise<number> {
  let sent = 0;
  for (const slice of chunk(profiles, IMPORT_CHUNK)) {
    const body: Record<string, unknown> = {
      data: {
        type: 'profile-bulk-import-job',
        attributes: { profiles: { data: slice } },
        ...(listId
          ? { relationships: { lists: { data: [{ type: 'list', id: listId }] } } }
          : {}),
      },
    };
    const res = await klaviyoFetch(apiKey, '/profile-import-bulk-create-jobs/', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.ok) sent += slice.length;
    else if (res.status === 401 || res.status === 403) {
      throw new KlaviyoUnauthorizedError();
    }
  }
  return sent;
}

/** Deja de recibir: supresión por correo (lo único que Klaviyo suprime así). */
async function suppressEmails(apiKey: string, emails: string[]): Promise<number> {
  let done = 0;
  for (const slice of chunk(emails, 100)) {
    const res = await klaviyoFetch(apiKey, '/profile-suppression-bulk-create-jobs/', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'profile-suppression-bulk-create-job',
          attributes: {
            profiles: {
              data: slice.map((email) => ({ type: 'profile', attributes: { email } })),
            },
          },
        },
      }),
    });
    if (res.ok) done += slice.length;
    else if (res.status === 401 || res.status === 403) {
      throw new KlaviyoUnauthorizedError();
    }
  }
  return done;
}

/** La clave dejó de servir (rotada o revocada): no tiene arreglo automático. */
export class KlaviyoUnauthorizedError extends Error {
  constructor() {
    super('klaviyo_unauthorized');
    this.name = 'KlaviyoUnauthorizedError';
  }
}

export interface KlaviyoSyncResult {
  scanned: number;
  synced: number;
  suppressed: number;
  skipped: number;
}

/**
 * Espeja en Klaviyo los contactos del workspace que cambiaron desde `since`.
 * Sin `since` (primera corrida) va la base entera, hasta el tope por corrida;
 * la marca de agua hace que las siguientes sean chicas.
 *
 * La ventana lleva un solape de una hora: `updated_at` lo escriben varios
 * caminos y un contacto que se guarda justo en el corte no se puede perder.
 */
export async function syncWorkspaceToKlaviyo(
  db: SupabaseClient,
  args: { workspaceId: string; apiKey: string; since: string | null },
): Promise<KlaviyoSyncResult> {
  const from = args.since
    ? new Date(new Date(args.since).getTime() - 60 * 60 * 1000).toISOString()
    : null;

  const contacts = await fetchAllRows<Contact>(
    (a, b) => {
      let q = db
        .from('contacts')
        .select('*')
        .eq('workspace_id', args.workspaceId)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true });
      if (from) q = q.gte('updated_at', from);
      return q.range(a, b);
    },
    { max: MAX_CONTACTS_PER_RUN },
  );

  if (contacts.length === 0) {
    return { scanned: 0, synced: 0, suppressed: 0, skipped: 0 };
  }

  // Etiquetas por contacto: es la mitad del valor de esto: sin ellas el
  // comercio recibe una lista plana y no puede segmentar nada.
  const tagsByContact = new Map<string, string[]>();
  const ids = contacts.map((c) => c.id);
  const tagNames = new Map<string, string>();
  const tagRows = await fetchAllRows<{ id: string; name: string }>((a, b) =>
    db
      .from('tags')
      .select('id, name')
      .eq('workspace_id', args.workspaceId)
      .order('id', { ascending: true })
      .range(a, b),
  );
  for (const t of tagRows) tagNames.set(t.id, t.name);

  for (const slice of chunk(ids, 300)) {
    const links = await fetchAllRows<{ contact_id: string; tag_id: string }>((a, b) =>
      db
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', slice)
        .order('contact_id', { ascending: true })
        .order('tag_id', { ascending: true })
        .range(a, b),
    );
    for (const l of links) {
      const name = tagNames.get(l.tag_id);
      if (!name) continue;
      const arr = tagsByContact.get(l.contact_id) ?? [];
      arr.push(name);
      tagsByContact.set(l.contact_id, arr);
    }
  }

  const active: KlaviyoProfile[] = [];
  const optedOut: KlaviyoProfile[] = [];
  const suppress: string[] = [];
  let skipped = 0;

  for (const c of contacts) {
    const profile = toKlaviyoProfile(c, tagsByContact.get(c.id) ?? []);
    if (!profile) {
      skipped++;
      continue;
    }
    if ((c as unknown as { opted_out?: boolean }).opted_out === true) {
      optedOut.push(profile);
      const email = c.email?.trim();
      if (email) suppress.push(email);
    } else {
      active.push(profile);
    }
  }

  const listId = active.length > 0 ? await ensureRiverzList(args.apiKey) : null;
  let synced = 0;
  if (active.length) synced += await importProfiles(args.apiKey, active, listId);
  // Los dados de baja se actualizan igual (para que la propiedad quede), pero
  // NUNCA entran a la lista.
  if (optedOut.length) synced += await importProfiles(args.apiKey, optedOut, null);
  const suppressed = suppress.length ? await suppressEmails(args.apiKey, suppress) : 0;

  return { scanned: contacts.length, synced, suppressed, skipped };
}
