import type { SupabaseClient } from '@supabase/supabase-js'

export const PERSONAL_EMAIL_CHANNELS = ['gmail', 'outlook', 'zoho'] as const
export async function canAccessConversation(db: SupabaseClient, userId: string, conversation: { channel: string; connection_id?: string | null }): Promise<boolean> {
  if (!(PERSONAL_EMAIL_CHANNELS as readonly string[]).includes(conversation.channel)) return true
  if (!conversation.connection_id) return false
  const result = await db.from('channel_connections').select('id').eq('id', conversation.connection_id).eq('created_by', userId).maybeSingle()
  if (result.error) throw new Error(result.error.message)
  return !!result.data
}
