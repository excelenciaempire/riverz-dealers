import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * La conversación de chat web de un visitante.
 *
 * Estaba escrita tres veces —el sondeo de mensajes, la calificación y ahora el
 * pedido de una persona— y las tres tenían que coincidir en algo que no es
 * obvio: cuál es "la" conversación cuando hay varias. Un hilo cerrado no se
 * reabre (lo decide `inbox-writer`), así que el visitante que vuelve a escribir
 * después de un cierre estrena conversación y quedan dos. La buena es siempre
 * la ÚLTIMA por fecha de creación; con cualquier otro criterio la calificación
 * se guardaba en el hilo viejo y el sondeo miraba el nuevo.
 *
 * Devuelve `null` cuando el visitante todavía no escribió: abrir el widget no
 * crea contacto ni conversación.
 */
export async function conversacionDelVisitante(
  workspaceId: string,
  visitorId: string,
): Promise<{ id: string; status: string } | null> {
  const admin = supabaseAdmin();
  const { data: contact } = await admin
    .from('contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', visitorId)
    .maybeSingle();
  if (!contact) return null;

  const { data } = await admin
    .from('conversations')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', (contact as { id: string }).id)
    .eq('channel', 'webchat')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; status: string } | null) ?? null;
}
