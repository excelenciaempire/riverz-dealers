import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { instagramAdapter } from '@/lib/channels/instagram/adapter';
import type { InstagramCampaign } from './types';

/**
 * Envía la tanda de DMs en cola de una campaña de Instagram.
 *
 * Usa instagramAdapter.sendText (Meta Graph, messaging_type=RESPONSE), que
 * solo está permitido dentro de la ventana de 24h tras una interacción del
 * usuario — justo el modelo del agente (responder a comentarios/historias/
 * DMs). El adapter no persiste en la BD; aquí solo actualizamos el estado del
 * recipient. La conversación entrante la materializa el webhook cuando la
 * persona responde (lo aprovecha la fase de captura).
 *
 * Debe llamarse con el cliente service-role (el cron no tiene sesión y hay
 * que leer connection.secrets).
 */
export async function sendCampaignBatch(
  db: SupabaseClient,
  campaign: Pick<InstagramCampaign, 'id' | 'workspace_id' | 'plan' | 'offer_code'>,
  limit = 25,
): Promise<{ sent: number; failed: number; remaining: number; skipped?: string }> {
  // 1) Conexión de Instagram del workspace.
  const { data: connRow } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', campaign.workspace_id)
    .eq('channel', 'instagram')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!connRow) {
    return { sent: 0, failed: 0, remaining: 0, skipped: 'instagram_not_connected' };
  }
  const connection = connRow as ChannelConnection;

  // 2) Recipients en cola con su contacto. Excluimos el grupo de control
  //    (holdout) y el spam; priorizamos por lead score (high primero).
  const { data: recipients } = await db
    .from('instagram_campaign_recipients')
    .select('id, contact_id, lead_score, contacts(id, external_id, name)')
    .eq('campaign_id', campaign.id)
    .eq('status', 'queued')
    .eq('is_holdout', false)
    .eq('is_spam', false)
    .limit(limit * 4);

  type ContactJoin = { id: string; external_id: string | null; name: string | null };
  const allRows = (recipients ?? []) as unknown as Array<{
    id: string;
    contact_id: string | null;
    lead_score: string | null;
    contacts: ContactJoin | ContactJoin[] | null;
  }>;
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const rows = allRows
    .slice()
    .sort((a, b) => (rank[a.lead_score ?? 'low'] ?? 3) - (rank[b.lead_score ?? 'low'] ?? 3))
    .slice(0, limit);
  if (rows.length === 0) {
    return { sent: 0, failed: 0, remaining: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const r of rows) {
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    if (!contact?.external_id) {
      await db
        .from('instagram_campaign_recipients')
        .update({ status: 'skipped', error: 'contacto sin external_id de Instagram' })
        .eq('id', r.id);
      continue;
    }

    const text = personalize(campaign.plan.message.text, contact.name);

    try {
      await instagramAdapter.sendText({
        channel: 'instagram',
        connection,
        // El adapter de Instagram no usa `conversation` para enviar; basta
        // con un objeto mínimo para satisfacer el contrato del tipo.
        conversation: { id: '' } as unknown as Conversation,
        contact: { id: contact.id, external_id: contact.external_id } as unknown as Contact,
        text,
      } satisfies OutboundText);

      await db
        .from('instagram_campaign_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', r.id);
      sent += 1;
    } catch (err) {
      await db
        .from('instagram_campaign_recipients')
        .update({
          status: 'failed',
          error: err instanceof Error ? err.message.slice(0, 500) : 'send failed',
        })
        .eq('id', r.id);
      failed += 1;
    }
  }

  // ¿Quedan más en cola (enviables) para la próxima vuelta del worker?
  const { count: remaining } = await db
    .from('instagram_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'queued')
    .eq('is_holdout', false)
    .eq('is_spam', false);

  return { sent, failed, remaining: remaining ?? 0 };
}

/** Reemplaza el token de nombre por el del contacto (o un saludo neutro). */
function personalize(template: string, name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] || 'hola';
  return template.replace(/\{\{\s*(nombre|name|1)\s*\}\}/gi, first);
}
