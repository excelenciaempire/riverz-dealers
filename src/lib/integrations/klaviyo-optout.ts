/**
 * La baja vale en los dos sentidos.
 *
 * Riverz ya suprime en Klaviyo a quien se dio de baja acá. Al revés no pasaba
 * nada: alguien apretaba "unsubscribe" en un correo de la marca y le seguían
 * llegando WhatsApp. Para la persona es la misma marca y el mismo "no me
 * escribas más" — y para el comercio es la diferencia entre una baja y un
 * reporte de spam, que en WhatsApp le pega a la calidad del número.
 *
 * Se leen los perfiles que Klaviyo tocó desde la última corrida y se marca
 * `opted_out` al contacto que corresponda. Sólo en ese sentido: no volvemos a
 * dar de alta a nadie automáticamente, porque el consentimiento de WhatsApp no
 * es el mismo que el del correo y no se hereda.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { klaviyoFetch, KlaviyoUnauthorizedError } from './klaviyo';
import { markOptedOut } from '@/lib/whatsapp/opt-out';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

/** Tope por corrida. */
const MAX_PROFILES = 5000;

interface KlaviyoSubscriptions {
  email?: {
    marketing?: { consent?: string | null; suppression?: unknown[] | null };
  };
  sms?: { marketing?: { consent?: string | null } };
}

/** Baja de verdad: sin consentimiento de correo NI de SMS. */
function isUnsubscribed(subs: KlaviyoSubscriptions | undefined): boolean {
  if (!subs) return false;
  const email = subs.email?.marketing?.consent;
  const sms = subs.sms?.marketing?.consent;
  const suppressed = (subs.email?.marketing?.suppression ?? []).length > 0;
  const emailOut = email === 'UNSUBSCRIBED' || suppressed;
  // Si nunca hubo consentimiento de SMS, no lo contamos como baja: la mayoría
  // de las cuentas sólo usan correo y marcaríamos a toda la base.
  const smsOut = sms === 'UNSUBSCRIBED';
  return emailOut || smsOut;
}

export interface OptOutSyncResult {
  scanned: number;
  optedOut: number;
}

export async function syncKlaviyoOptOuts(
  db: SupabaseClient,
  args: { workspaceId: string; apiKey: string; since: string | null },
): Promise<OptOutSyncResult> {
  const result: OptOutSyncResult = { scanned: 0, optedOut: 0 };
  // Sin marca de agua sólo se mira el último día: la primera corrida no tiene
  // que barrer el historial entero de la cuenta.
  const since = args.since
    ? new Date(new Date(args.since).getTime() - 60 * 60 * 1000)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const iso = since.toISOString().replace(/\.\d+Z$/, 'Z');

  const identifiers: Array<{ email: string | null; phone: string | null }> = [];
  let url: string | null =
    `/profiles/?filter=greater-than(updated,${iso})` +
    `&additional-fields[profile]=subscriptions&fields[profile]=email,phone_number,subscriptions&page[size]=100`;

  while (url && result.scanned < MAX_PROFILES) {
    const res = await klaviyoFetch(args.apiKey, url);
    if (res.status === 401 || res.status === 403) throw new KlaviyoUnauthorizedError();
    if (!res.ok) break;
    const json = (await res.json()) as {
      data?: Array<{
        attributes?: {
          email?: string | null;
          phone_number?: string | null;
          subscriptions?: KlaviyoSubscriptions;
        };
      }>;
      links?: { next?: string | null };
    };
    for (const p of json.data ?? []) {
      result.scanned++;
      if (!isUnsubscribed(p.attributes?.subscriptions)) continue;
      identifiers.push({
        email: p.attributes?.email?.trim().toLowerCase() ?? null,
        phone: sanitizePhoneForMeta(p.attributes?.phone_number ?? '') || null,
      });
    }
    const next = json.links?.next ?? null;
    url = next ? next.replace('https://a.klaviyo.com/api', '') : null;
  }

  if (identifiers.length === 0) return result;

  // Emparejar contra la base una sola vez, igual que el sync de segmentos.
  const contacts = await fetchAllRows<{
    id: string;
    email: string | null;
    phone: string | null;
    opted_out: boolean | null;
  }>((a, b) =>
    db
      .from('contacts')
      .select('id, email, phone, opted_out')
      .eq('workspace_id', args.workspaceId)
      .order('id', { ascending: true })
      .range(a, b),
  );
  const byEmail = new Map<string, { id: string; opted: boolean }>();
  const byPhone = new Map<string, { id: string; opted: boolean }>();
  for (const c of contacts) {
    const entry = { id: c.id, opted: c.opted_out === true };
    const mail = c.email?.trim().toLowerCase();
    if (mail && !byEmail.has(mail)) byEmail.set(mail, entry);
    const digits = sanitizePhoneForMeta(c.phone ?? '');
    if (digits) {
      byPhone.set(digits, entry);
      const tail = digits.slice(-8);
      if (tail.length === 8 && !byPhone.has(tail)) byPhone.set(tail, entry);
    }
  }

  const done = new Set<string>();
  for (const idf of identifiers) {
    const hit =
      (idf.email ? byEmail.get(idf.email) : undefined) ??
      (idf.phone ? byPhone.get(idf.phone) ?? byPhone.get(idf.phone.slice(-8)) : undefined);
    if (!hit || hit.opted || done.has(hit.id)) continue;
    done.add(hit.id);
    await markOptedOut(db, args.workspaceId, hit.id, 'klaviyo_unsubscribe');
    result.optedOut++;
  }

  return result;
}
