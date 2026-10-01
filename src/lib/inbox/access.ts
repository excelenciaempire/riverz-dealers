import type { SupabaseClient } from '@supabase/supabase-js'

export const PERSONAL_EMAIL_CHANNELS = ['gmail', 'outlook', 'zoho'] as const
export async function canAccessConversation(db: SupabaseClient, userId: string, conversation: { channel: string; connection_id?: string | null }, workspaceId?: string): Promise<boolean> {
  if (!(PERSONAL_EMAIL_CHANNELS as readonly string[]).includes(conversation.channel)) return true
  if (!conversation.connection_id) return false
  let query = db.from('channel_connections').select('id').eq('id', conversation.connection_id).eq('created_by', userId)
  if (workspaceId) query = query.eq('workspace_id', workspaceId).eq('channel', conversation.channel)
  const result = await query.maybeSingle()
  if (result.error) throw new Error(result.error.message)
  return !!result.data && (!workspaceId || result.data.id === conversation.connection_id)
}
