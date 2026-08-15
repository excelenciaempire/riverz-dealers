/**
 * Los segmentos de Klaviyo, disponibles en Riverz como etiquetas.
 *
 * El comercio ya construyó ahí su "VIP", su "compró y no volvió", su "abre
 * pero no compra". Rehacerlos en Riverz sería pedirle que mantenga la misma
 * definición en dos lugares — que es como se desincronizan las cosas.
 *
 * En vez de una audiencia nueva en el asistente de campañas, cada segmento
 * baja como una ETIQUETA `Klaviyo: <nombre>`. Así funciona en todo lo que ya
 * existe sin tocar nada: filtro de contactos, audiencia de campaña, condición
 * de automatización, segmento guardado.
 *
 * La pertenencia se REEMPLAZA en cada corrida: quien salió del segmento en
 * Klaviyo pierde la etiqueta acá. Si no, la etiqueta sólo crecería y en un mes
 * "VIP" sería "todos los que alguna vez fueron VIP".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk, fetchAllRows } from '@/lib/supabase/paginate';
import { klaviyoFetch, KlaviyoUnauthorizedError } from './klaviyo';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

/** Prefijo del nombre de la etiqueta. Es lo que las identifica como traídas. */
export const TAG_PREFIX = 'Klaviyo: ';
/** Color de las etiquetas importadas (el morado de Klaviyo). */
const TAG_COLOR = '#7c3aed';

/** Topes por corrida: traer todo de una cuenta grande no es el trabajo de un tick. */
const MAX_SEGMENTS = 20;
const MAX_PROFILES_PER_SEGMENT = 20_000;

interface KlaviyoSegment {
  id: string;
  name: string;
}

async function listSegments(apiKey: string): Promise<KlaviyoSegment[]> {
  const res = await klaviyoFetch(apiKey, '/segments/');
  if (res.status === 401 || res.status === 403) throw new KlaviyoUnauthorizedError();
  if (!res.ok) return [];
  const json = (await res.json()) as {
    data?: Array<{ id?: string; attributes?: { name?: string } }>;
  };
  return (json.data ?? [])
    .map((s) => ({ id: String(s.id ?? ''), name: String(s.attributes?.name ?? '').trim() }))
    .filter((s) => s.id && s.name)
    .slice(0, MAX_SEGMENTS);
}

/** Correos y teléfonos de quienes están HOY en el segmento. */
async function segmentMembers(
  apiKey: string,
  segmentId: string,
): Promise<{ emails: Set<string>; phones: Set<string> }> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  let url: string | null =
    `/segments/${segmentId}/profiles/?fields[profile]=email,phone_number&page[size]=100`;
  let fetched = 0;
  while (url && fetched < MAX_PROFILES_PER_SEGMENT) {
    const res = await klaviyoFetch(apiKey, url);
    if (res.status === 401 || res.status === 403) throw new KlaviyoUnauthorizedError();
    if (!res.ok) break;
    const json = (await res.json()) as {
      data?: Array<{ attributes?: { email?: string | null; phone_number?: string | null } }>;
      links?: { next?: string | null };
    };
    for (const p of json.data ?? []) {
      const mail = p.attributes?.email?.trim().toLowerCase();
      if (mail) emails.add(mail);
      const digits = sanitizePhoneForMeta(p.attributes?.phone_number ?? '');
      if (digits) phones.add(digits);
      fetched++;
    }
    // Klaviyo pagina con una URL absoluta; la recortamos al path que espera
    // nuestro cliente.
    const next = json.links?.next ?? null;
    url = next ? next.replace('https://a.klaviyo.com/api', '') : null;
  }
  return { emails, phones };
}

export interface SegmentSyncResult {
  segments: number;
  tagged: number;
  untagged: number;
}

export async function syncKlaviyoSegments(
  db: SupabaseClient,
  args: { workspaceId: string; apiKey: string; ownerUserId: string | null },
): Promise<SegmentSyncResult> {
  const segments = await listSegments(args.apiKey);
  const result: SegmentSyncResult = { segments: 0, tagged: 0, untagged: 0 };
  if (segments.length === 0) return result;

  // Un solo barrido de la base para poder emparejar por correo o por teléfono.
  const contacts = await fetchAllRows<{
    id: string;
    email: string | null;
    phone: string | null;
  }>((a, b) =>
    db
      .from('contacts')
      .select('id, email, phone')
      .eq('workspace_id', args.workspaceId)
      .order('id', { ascending: true })
      .range(a, b),
  );
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const c of contacts) {
    const mail = c.email?.trim().toLowerCase();
    if (mail && !byEmail.has(mail)) byEmail.set(mail, c.id);
    const digits = sanitizePhoneForMeta(c.phone ?? '');
    // Los últimos 8 dígitos alcanzan para emparejar formatos distintos del
    // mismo número (el "9" argentino, el prefijo con y sin país).
    if (digits) {
      byPhone.set(digits, c.id);
      const tail = digits.slice(-8);
      if (tail.length === 8 && !byPhone.has(tail)) byPhone.set(tail, c.id);
    }
  }

  for (const segment of segments) {
    const members = await segmentMembers(args.apiKey, segment.id);
    const contactIds = new Set<string>();
    for (const mail of members.emails) {
      const id = byEmail.get(mail);
      if (id) contactIds.add(id);
    }
    for (const digits of members.phones) {
      const id = byPhone.get(digits) ?? byPhone.get(digits.slice(-8));
      if (id) contactIds.add(id);
    }

    const tagId = await ensureTag(db, {
      workspaceId: args.workspaceId,
      name: `${TAG_PREFIX}${segment.name}`,
      ownerUserId: args.ownerUserId,
    });
    if (!tagId) continue;
    result.segments++;

    const current = await fetchAllRows<{ contact_id: string }>((a, b) =>
      db
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', tagId)
        .order('contact_id', { ascending: true })
        .range(a, b),
    );
    const currentIds = new Set(current.map((r) => r.contact_id));

    const toAdd = [...contactIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !contactIds.has(id));

    for (const slice of chunk(toAdd, 500)) {
      const { error } = await db
        .from('contact_tags')
        .upsert(
          slice.map((contact_id) => ({ contact_id, tag_id: tagId })),
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
        );
      if (!error) result.tagged += slice.length;
    }
    for (const slice of chunk(toRemove, 500)) {
      const { error } = await db
        .from('contact_tags')
        .delete()
        .eq('tag_id', tagId)
        .in('contact_id', slice);
      if (!error) result.untagged += slice.length;
    }
  }

  return result;
}

/** Busca la etiqueta por nombre dentro del workspace; la crea si no está. */
async function ensureTag(
  db: SupabaseClient,
  args: { workspaceId: string; name: string; ownerUserId: string | null },
): Promise<string | null> {
  const { data: found } = await db
    .from('tags')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('name', args.name)
    .maybeSingle();
  const existing = (found as { id?: string } | null)?.id;
  if (existing) return existing;

  const { data, error } = await db
    .from('tags')
    .insert({
      workspace_id: args.workspaceId,
      name: args.name,
      color: TAG_COLOR,
      user_id: args.ownerUserId,
    })
    .select('id')
    .maybeSingle();
  if (error) return null;
  return (data as { id?: string } | null)?.id ?? null;
}
