import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/flows/admin-client';

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

/** Send a signed event. Callers own retries/queues for product-critical flows. */
export async function emitWebhook(
  workspaceId: string,
  type: RiverzWebhookEvent,
  data: Record<string, unknown>,
  endpointId?: string,
): Promise<void> {
  const admin = supabaseAdmin();
  let query = admin.from('webhook_endpoints')
    .select('id, url, secret')
    .eq('workspace_id', workspaceId).eq('is_active', true);
  if (endpointId) query = query.eq('id', endpointId);
  else query = query.contains('events', [type]);
  const { data: endpoints } = await query;
  const eventId = crypto.randomUUID();
  const payload = JSON.stringify({ id: eventId, type, created_at: new Date().toISOString(), data });
  await Promise.all((endpoints ?? []).map(async (endpoint: { id: string; url: string; secret: string }) => {
    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    try {
      const signature = crypto.createHmac('sha256', endpoint.secret).update(payload).digest('hex');
      const response = await fetch(endpoint.url, {
        method: 'POST', body: payload,
        headers: { 'content-type': 'application/json', 'x-riverz-event': type, 'x-riverz-event-id': eventId, 'x-riverz-signature': `sha256=${signature}` },
        signal: AbortSignal.timeout(8_000),
      });
      statusCode = response.status;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message.slice(0, 500) : 'delivery_failed';
    }
    await admin.from('webhook_deliveries').insert({ endpoint_id: endpoint.id, event_id: eventId, event_type: type, status_code: statusCode, succeeded: !!statusCode && statusCode >= 200 && statusCode < 300, error_message: errorMessage });
  }));
}
