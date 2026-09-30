import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
export class InboxSpamError extends Error { readonly code='inbox_case_spam';constructor() { super('inbox_case_spam') } }
export async function inboxCaseIsSpam(db:SupabaseClient,workspaceId:string,conversationId:string):Promise<boolean> {
  const row=await db.from('conversations').select('is_spam').eq('workspace_id',workspaceId).eq('id',conversationId).is('deleted_at',null).maybeSingle()
  if (row.error || !row.data || typeof row.data.is_spam!=='boolean') throw new Error('inbox_disposition_unavailable')
  return row.data.is_spam
}
export async function assertInboxCaseCanSend(db:SupabaseClient,workspaceId:string,conversationId:string) {
  if (await inboxCaseIsSpam(db,workspaceId,conversationId)) throw new InboxSpamError()
}
