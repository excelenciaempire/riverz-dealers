import type { SupabaseClient } from '@supabase/supabase-js';
import { syncLeadToKlaviyo, resolveKlaviyoKey } from './klaviyo-sync';

/**
 * Detecta respuestas entrantes y captura leads para una campaña.
 *
 * Para cada destinatario `sent`, busca si su contacto respondió (un mensaje
 * entrante `sender_type='customer'` posterior al envío). Si respondió:
 *   - marca el recipient como `replied` (+ replied_at),
 *   - intenta capturar email/teléfono del texto de la respuesta y lo guarda
 *     en el contacto si todavía no lo tenía (zero-party data, al estilo
 *     Blueberry).
 *
 * Service-role: el cron no tiene sesión.
 */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;

export async function detectRepliesAndCapture(
  db: SupabaseClient,
  campaignId: string,
  workspaceId: string,
  limit = 200,
): Promise<{ replied: number; captured: number }> {
  // Resolver la key de Klaviyo del workspace una sola vez por tanda.
  const klaviyoKey = await resolveKlaviyoKey(db, workspaceId);

  const { data: recipients } = await db
    .from('instagram_campaign_recipients')
    .select('id, contact_id, sent_at')
    .eq('campaign_id', campaignId)
    .eq('status', 'sent')
    .not('contact_id', 'is', null)
    .limit(limit);

  const rows = (recipients ?? []) as Array<{
    id: string;
    contact_id: string;
    sent_at: string | null;
  }>;
  if (rows.length === 0) return { replied: 0, captured: 0 };

  let replied = 0;
  let captured = 0;

  for (const r of rows) {
    const since = r.sent_at ?? new Date(0).toISOString();

    // Conversaciones del contacto (una por canal normalmente).
    const { data: convs } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', r.contact_id);
    const convIds = (convs ?? []).map((c) => (c as { id: string }).id);
    if (convIds.length === 0) continue;

    // ¿Hay mensaje entrante del cliente después del envío?
    const { data: msgs } = await db
      .from('messages')
      .select('content_text, created_at')
      .in('conversation_id', convIds)
      .eq('sender_type', 'customer')
      .gt('created_at', since)
      .order('created_at', { ascending: true })
      .limit(10);
    const inbound = (msgs ?? []) as Array<{ content_text: string | null }>;
    if (inbound.length === 0) continue;

    // Atomically claim sent → replied. If the real-time closer already
    // marked this recipient replied, the claim affects no rows and we skip —
    // so we don't re-capture / re-sync the same lead to Klaviyo twice.
    const { data: claimed } = await db
      .from('instagram_campaign_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('status', 'sent')
      .select('id');
    if (!(claimed as Array<{ id: string }> | null)?.length) continue;
    replied += 1;

    // Captura de email/teléfono desde el texto de las respuestas.
    const text = inbound.map((m) => m.content_text ?? '').join('\n');
    const email = text.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
    const phoneRaw = text.match(PHONE_RE)?.[0] ?? null;
    const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, '') : null;
    if (!email && !phone) continue;

    const { data: contact } = await db
      .from('contacts')
      .select('id, name, email, phone')
      .eq('id', r.contact_id)
      .maybeSingle();
    const c = contact as
      | { name: string | null; email: string | null; phone: string | null }
      | null;
    const patch: Record<string, string> = {};
    // `afirmado`: lo escribio la persona en un DM. Se guarda para poder
    // escribirle, pero no une fichas -- ver `contacts/identidad-probada.ts`.
    if (email && !c?.email) {
      patch.email = email;
      patch.email_origen = 'afirmado';
    }
    if (phone && phone.length >= 8 && !c?.phone) {
      patch.phone = phone;
      patch.phone_origen = 'afirmado';
    }
    if (Object.keys(patch).length > 0) {
      await db.from('contacts').update(patch).eq('id', r.contact_id);
      captured += 1;
      // Owned audience: empujar el lead a Klaviyo (no-op si no hay API key).
      await syncLeadToKlaviyo(
        {
          email: patch.email ?? c?.email,
          phone: patch.phone ?? c?.phone,
          name: c?.name,
        },
        klaviyoKey,
      );
    }
  }

  return { replied, captured };
}
