import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { postPublicWebhook, WebhookPostError } from '@/lib/security/post-public-webhook';

export type RiverzWebhookEvent =
  | 'conversation.created'
  | 'conversation.escalated'
  | 'conversation.resolved'
  | 'message.received'
  | 'message.sent'
  | 'order.created'
  | 'order.updated'
  | 'shipment.updated'
  | 'tracking.updated'
  | 'delivery.incident.opened'
  | 'delivery.incident.resolved'
  | 'payment.approved'
  | 'payment.rejected';

export const WEBHOOK_EVENTS: RiverzWebhookEvent[] = [
  'conversation.created', 'conversation.escalated', 'conversation.resolved',
  'message.received', 'message.sent', 'order.created', 'order.updated',
  'shipment.updated', 'tracking.updated',
  'delivery.incident.opened', 'delivery.incident.resolved',
  'payment.approved', 'payment.rejected',
];

export interface WebhookDeliveryResult { attempted: number; succeeded: number; failed: number; unavailable: boolean }

/** Send a signed event. Callers own retries/queues for product-critical flows. */
export async function emitWebhook(
  workspaceId: string,
  type: RiverzWebhookEvent,
  data: Record<string, unknown>,
  endpointId?: string,
): Promise<WebhookDeliveryResult> {
  const admin = supabaseAdmin();
  let query = admin.from('webhook_endpoints')
    .select('id, url, secret')
    .eq('workspace_id', workspaceId).eq('is_active', true);
  if (endpointId) query = query.eq('id', endpointId);
  else query = query.contains('events', [type]);
  const { data: endpoints, error: endpointError } = await query;
  if (endpointError) return { attempted: 0, succeeded: 0, failed: 0, unavailable: true };
  const eventId = crypto.randomUUID();
  const payload = JSON.stringify({ id: eventId, type, created_at: new Date().toISOString(), data });
  const results = await Promise.all((endpoints ?? []).map(async (endpoint: { id: string; url: string; secret: string }) => {
    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    try {
      const signature = crypto.createHmac('sha256', endpoint.secret).update(payload).digest('hex');
      statusCode = await postPublicWebhook(endpoint.url, payload, {
        'content-type': 'application/json', 'x-riverz-event': type,
        'x-riverz-event-id': eventId, 'x-riverz-signature': `sha256=${signature}`,
      });
      if (statusCode >= 300 && statusCode < 400) errorMessage = 'webhook_redirect_rejected';
    } catch (error) {
      errorMessage = error instanceof WebhookPostError ? error.code : 'webhook_delivery_failed';
    }
    const succeeded = !!statusCode && statusCode >= 200 && statusCode < 300;
    const { error: receiptError } = await admin.from('webhook_deliveries').insert({ endpoint_id: endpoint.id, event_id: eventId, event_type: type, status_code: statusCode, succeeded, error_message: errorMessage });
    return { succeeded, recorded: !receiptError };
  }));
  return { attempted: results.length, succeeded: results.filter(result => result.succeeded).length,
    failed: results.filter(result => !result.succeeded).length, unavailable: results.some(result => !result.recorded) };
}
