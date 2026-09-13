import type { SupabaseClient } from '@supabase/supabase-js'
import { metaErrorText } from '@/lib/whatsapp/delivery-errors'

export interface BroadcastDeliveryStatus {
  id?: string
  status?: string
  timestamp?: string
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
}

/** The unified WhatsApp webhook must also update campaigns without inbox rows. */
export async function mirrorBroadcastDelivery(db: SupabaseClient, workspaceId: string, status: BroadcastDeliveryStatus) {
  if (!status.id || !status.status || !workspaceId) return
  const ladder = ['pending', 'sent', 'delivered', 'read']
  const allowed = status.status === 'failed' ? ['pending', 'sent'] : ladder.slice(0, ladder.indexOf(status.status))
  if (!['sent', 'delivered', 'read', 'failed'].includes(status.status) || allowed.length === 0) return
  const time = Number(status.timestamp) * 1000
  if (!Number.isFinite(time) || time <= 0) return
  const { data, error } = await db.from('broadcast_recipients')
    .select('id, broadcasts!inner(workspace_id)')
    .eq('whatsapp_message_id', status.id).eq('broadcasts.workspace_id', workspaceId)
  if (error) throw error
  const patch: Record<string, unknown> = { status: status.status }
  if (status.status === 'failed') patch.error_message = metaErrorText(status.errors)
  else patch[`${status.status}_at`] = new Date(time).toISOString()
  for (const row of data ?? []) {
    const { error: updateError } = await db.from('broadcast_recipients').update(patch).eq('id', row.id).in('status', allowed)
    if (updateError) throw updateError
  }
}
