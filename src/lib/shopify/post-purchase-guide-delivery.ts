import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { getFreshAccessToken } from '@/lib/channels/gmail/watch';
import { tokenVivo } from './token-vivo';
import { nextPageInfo } from './admin-client';
import {
  guideEmailRaw,
  guideMessageId,
  guideRecipient,
  guideSendFailure,
  qualifiesForGuide,
  type GuideOrder,
  type GuideRule,
} from './post-purchase-guide';

interface Guide extends GuideRule {
  id: string;
  workspace_id: string;
  shop_domain: string;
  connection_id: string;
  file_url: string;
  subject: string;
  body: string;
  scan_after: string;
  scan_until: string | null;
  scan_page_url: string | null;
}
interface Delivery {
  id: string;
  order_id: string;
  status: string;
  attempts: number;
  started_at: string | null;
  recipient_email?: string | null;
  email_subject?: string | null;
}
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FIELDS =
  'id,name,email,contact_email,created_at,financial_status,cancelled_at,test,line_items';
const checked = <T extends { error: unknown }>(result: T): T => {
  if (result.error) throw result.error;
  return result;
};
const gmailHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'content-type': 'application/json',
});

async function findSent(
  token: string,
  messageId: string,
  recipient: string,
  subject: string
): Promise<string | null> {
  const url = new URL(`${API}/messages`);
  const quotedSubject = subject.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  url.searchParams.set(
    'q',
    `in:sent to:${recipient} subject:"${quotedSubject}"`
  );
  url.searchParams.set('maxResults', '25');
  const r = await fetch(url, {
    headers: gmailHeaders(token),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`guide_gmail_lookup_${r.status}`);
  const data = (await r.json()) as { messages?: Array<{ id: string }> };
  for (const message of data.messages ?? []) {
    const metadata = await fetch(
      `${API}/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=X-Riverz-Guide-Delivery`,
      { headers: gmailHeaders(token), signal: AbortSignal.timeout(15000) }
    );
    if (!metadata.ok) throw new Error(`guide_gmail_receipt_${metadata.status}`);
    const details = (await metadata.json()) as {
      labelIds?: string[];
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    if (
      details.labelIds?.includes('SENT') &&
      details.payload?.headers?.some(
        (header) =>
          header.name.toLowerCase() === 'x-riverz-guide-delivery' &&
          header.value === messageId
      )
    )
      return message.id;
  }
  return null;
}

/** No wallet or AI call: this is delivery of a gift already included in a purchase. */
export async function deliverPostPurchaseGuides(db: SupabaseClient) {
  const summary = {
    scanned: 0,
    queued: 0,
    sent: 0,
    reconciled: 0,
    skipped: 0,
    failed: 0,
    uncertain: 0,
    errors: 0,
  };
  const configuration = await db
    .from('post_purchase_guides')
    .select('*')
    .eq('enabled', true);
  // This opt-in feature stays off until its additive migration is available.
  if (
    configuration.error &&
    ['PGRST205', '42P01'].includes(configuration.error.code)
  )
    return { ...summary, disabled: 'schema_not_installed' };
  const guides = checked(configuration).data as Guide[];
  for (const guide of guides) {
    try {
      const connection = checked(
        await db
          .from('shopify_connections')
          .select('*')
          .eq('workspace_id', guide.workspace_id)
          .eq('shop_domain', guide.shop_domain)
          .eq('platform', 'shopify')
          .eq('status', 'active')
          .single()
      ).data;
      const { accessToken } = await tokenVivo(db, connection);
      const shopHeaders = { 'X-Shopify-Access-Token': accessToken };
      const base = `https://${guide.shop_domain}/admin/api/2026-07`;
      // Persist the snapshot/cursor only after its orders have been queued.
      const until = guide.scan_until ?? new Date().toISOString();
      let url = new URL(guide.scan_page_url ?? `${base}/orders.json`);
      if (!guide.scan_page_url) {
        url.searchParams.set('status', 'any');
        url.searchParams.set('limit', '250');
        url.searchParams.set('fields', FIELDS);
        url.searchParams.set('updated_at_min', guide.scan_after);
        url.searchParams.set('updated_at_max', until);
      }
      for (let page = 0; page < 4; page++) {
        if (
          url.origin !== `https://${guide.shop_domain}` ||
          url.pathname !== `/admin/api/2026-07/orders.json`
        )
          throw new Error('invalid_guide_scan_cursor');
        const res = await fetch(url, {
          headers: shopHeaders,
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`guide_shopify_scan_${res.status}`);
        const orders = ((await res.json()) as { orders: GuideOrder[] }).orders;
        if (!Array.isArray(orders))
          throw new Error('invalid_guide_orders_response');
        summary.scanned += orders.length;
        for (const order of orders) {
          if (!qualifiesForGuide(order, guide)) continue;
          const result = checked(
            await db
              .from('post_purchase_guide_deliveries')
              .upsert(
                {
                  guide_id: guide.id,
                  workspace_id: guide.workspace_id,
                  order_id: String(order.id),
                },
                { onConflict: 'guide_id,order_id', ignoreDuplicates: true }
              )
              .select('id')
          );
          summary.queued += result.data?.length ?? 0;
        }
        const next = nextPageInfo(res.headers.get('link'));
        if (!next) {
          checked(
            await db
              .from('post_purchase_guides')
              .update({
                scan_after: new Date(Date.parse(until) - 60000).toISOString(),
                scan_until: null,
                scan_page_url: null,
              })
              .eq('id', guide.id)
              .eq('workspace_id', guide.workspace_id)
          );
          break;
        }
        url = new URL(`${base}/orders.json`);
        url.searchParams.set('page_info', next);
        url.searchParams.set('limit', '250');
        url.searchParams.set('fields', FIELDS);
        checked(
          await db
            .from('post_purchase_guides')
            .update({ scan_until: until, scan_page_url: url.toString() })
            .eq('id', guide.id)
            .eq('workspace_id', guide.workspace_id)
        );
      }
      const mailbox = checked(
        await db
          .from('channel_connections')
          .select('*')
          .eq('id', guide.connection_id)
          .eq('workspace_id', guide.workspace_id)
          .eq('channel', 'gmail')
          .eq('status', 'connected')
          .single()
      ).data as ChannelConnection;
      const token = await getFreshAccessToken(db, mailbox);
      if (!token) throw new Error('guide_mailbox_token_unavailable');
      const from = String(
        mailbox.config?.email ?? mailbox.external_account_id ?? ''
      );
      if (!guideRecipient({ email: from } as GuideOrder))
        throw new Error('guide_invalid_sender');
      // A crash during a send is uncertain, never an invitation to resend.
      checked(
        await db
          .from('post_purchase_guide_deliveries')
          .update({ status: 'uncertain', last_error: 'interrupted_send' })
          .eq('guide_id', guide.id)
          .eq('workspace_id', guide.workspace_id)
          .eq('status', 'sending')
          .lt('started_at', new Date(Date.now() - 10 * 60000).toISOString())
      );
      const unresolved = checked(
        await db
          .from('post_purchase_guide_deliveries')
          .select(
            'id,order_id,status,attempts,started_at,recipient_email,email_subject'
          )
          .eq('guide_id', guide.id)
          .eq('workspace_id', guide.workspace_id)
          .eq('status', 'uncertain')
          .limit(25)
      ).data as Delivery[];
      for (const row of unresolved) {
        if (!row.recipient_email || !row.email_subject) {
          summary.uncertain++;
          continue;
        }
        const found = await findSent(
          token,
          guideMessageId(guide.id, row.order_id),
          row.recipient_email,
          row.email_subject
        );
        if (found) {
          checked(
            await db
              .from('post_purchase_guide_deliveries')
              .update({
                status: 'sent',
                external_message_id: found,
                sent_at: new Date().toISOString(),
                last_error: null,
              })
              .eq('id', row.id)
              .eq('workspace_id', guide.workspace_id)
          );
          summary.reconciled++;
        } else summary.uncertain++;
      }
      const due = checked(
        await db
          .from('post_purchase_guide_deliveries')
          .select('id,order_id,status,attempts,started_at')
          .eq('guide_id', guide.id)
          .eq('workspace_id', guide.workspace_id)
          .eq('status', 'pending')
          .lte('next_attempt_at', new Date().toISOString())
          .order('next_attempt_at')
          .limit(25)
      ).data as Delivery[];
      for (const row of due) {
        const live = await fetch(
          `${base}/orders/${encodeURIComponent(row.order_id)}.json?fields=${FIELDS}`,
          { headers: shopHeaders, signal: AbortSignal.timeout(15000) }
        );
        if (!live.ok) throw new Error(`guide_shopify_order_${live.status}`);
        const order = ((await live.json()) as { order: GuideOrder }).order;
        if (!order || String(order.id) !== row.order_id)
          throw new Error('guide_order_identity_mismatch');
        if (!qualifiesForGuide(order, guide)) {
          checked(
            await db
              .from('post_purchase_guide_deliveries')
              .update({
                status: 'cancelled',
                last_error: 'order_no_longer_eligible',
              })
              .eq('id', row.id)
              .eq('status', 'pending')
              .eq('workspace_id', guide.workspace_id)
          );
          summary.skipped++;
          continue;
        }
        const to = guideRecipient(order);
        if (!to) {
          checked(
            await db
              .from('post_purchase_guide_deliveries')
              .update({
                next_attempt_at: new Date(Date.now() + 3600000).toISOString(),
                last_error: 'missing_order_email',
              })
              .eq('id', row.id)
              .eq('workspace_id', guide.workspace_id)
              .eq('status', 'pending')
          );
          summary.skipped++;
          continue;
        }
        const messageId = guideMessageId(guide.id, row.order_id);
        const subject = guide.subject.replaceAll(
          '{{order_name}}',
          order.name ?? row.order_id
        );
        const found = await findSent(token, messageId, to, subject);
        if (found) {
          checked(
            await db
              .from('post_purchase_guide_deliveries')
              .update({
                status: 'sent',
                external_message_id: found,
                sent_at: new Date().toISOString(),
                last_error: null,
              })
              .eq('id', row.id)
              .eq('workspace_id', guide.workspace_id)
              .eq('status', 'pending')
          );
          summary.reconciled++;
          continue;
        }
        const raw = guideEmailRaw({
          from,
          to,
          messageId,
          subject,
          body: guide.body
            .replaceAll('{{order_name}}', order.name ?? row.order_id)
            .replaceAll('{{guide_url}}', guide.file_url),
        });
        const claim = checked(
          await db
            .from('post_purchase_guide_deliveries')
            .update({
              status: 'sending',
              started_at: new Date().toISOString(),
              attempts: row.attempts + 1,
              recipient_email: to,
              email_subject: subject,
            })
            .eq('id', row.id)
            .eq('workspace_id', guide.workspace_id)
            .eq('status', 'pending')
            .select('id')
            .maybeSingle()
        ).data;
        if (!claim) continue;
        try {
          const sent = await fetch(`${API}/messages/send`, {
            method: 'POST',
            headers: gmailHeaders(token),
            body: JSON.stringify({ raw }),
            signal: AbortSignal.timeout(20000),
          });
          if (!sent.ok) {
            const disposition = guideSendFailure(sent.status, row.attempts);
            checked(
              await db
                .from('post_purchase_guide_deliveries')
                .update({
                  status: disposition,
                  next_attempt_at: new Date(
                    Date.now() + Math.min(60, 5 * 2 ** row.attempts) * 60000
                  ).toISOString(),
                  last_error: `gmail_send_${sent.status}`,
                })
                .eq('id', row.id)
                .eq('workspace_id', guide.workspace_id)
            );
            if (disposition === 'uncertain') summary.uncertain++;
            else summary.failed++;
            continue;
          }
          const result = (await sent.json()) as { id?: string };
          if (!result.id) throw new Error('gmail_missing_send_receipt');
          checked(
            await db
              .from('post_purchase_guide_deliveries')
              .update({
                status: 'sent',
                external_message_id: result.id,
                sent_at: new Date().toISOString(),
                last_error: null,
              })
              .eq('id', row.id)
              .eq('workspace_id', guide.workspace_id)
          );
          summary.sent++;
        } catch {
          checked(
            await db
              .from('post_purchase_guide_deliveries')
              .update({
                status: 'uncertain',
                last_error: 'send_result_uncertain',
              })
              .eq('id', row.id)
              .eq('workspace_id', guide.workspace_id)
              .eq('status', 'sending')
          );
          summary.uncertain++;
        }
      }
      checked(
        await db
          .from('post_purchase_guides')
          .update({
            last_error: summary.uncertain
              ? 'delivery_requires_reconciliation'
              : null,
          })
          .eq('id', guide.id)
          .eq('workspace_id', guide.workspace_id)
      );
    } catch (error) {
      summary.errors++;
      await db
        .from('post_purchase_guides')
        .update({
          last_error:
            error instanceof Error ? error.message : 'guide_delivery_error',
        })
        .eq('id', guide.id)
        .eq('workspace_id', guide.workspace_id);
    }
  }
  return summary;
}
