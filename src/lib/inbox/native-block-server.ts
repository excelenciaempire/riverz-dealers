import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/channels/encryption'
import { nativeBlocked,setNativeBlocked,NativeBlockError,type BlockAccount } from '@/lib/whatsapp/native-block'
import type { NativeBlockInput,NativeBlockOperation,NativeBlockView } from './native-block-contract'
type Row=Omit<NativeBlockOperation,'reviewable'> & { fingerprint:string;phone_number_id:string;recipient:string;conversation_id:string | null;actor_id:string | null }
type Context={ db:SupabaseClient;workspaceId:string;userId:string;conversation:{ id:string };isAdmin:boolean }
export class NativeBlockContextError extends Error { constructor(readonly code:string) { super(code) } }
async function rpc(db:SupabaseClient,name:string,args:Record<string,unknown>) {
  const result=await db.rpc(name,args)
  if (result.error) throw new NativeBlockContextError(result.error.message)
  return result.data
}
export async function loadNativeBlockAccount(db:SupabaseClient,workspaceId:string,conversationId:string) {
  const c=await db.from('conversations').select('id,channel,contact_id,connection_id').eq('workspace_id',workspaceId).eq('id',conversationId).is('deleted_at',null).maybeSingle()
  if (c.error || !c.data || c.data.channel!=='whatsapp' || !c.data.connection_id || !c.data.contact_id) throw new NativeBlockError('block_unavailable')
  const [contact,connection]=await Promise.all([
    db.from('contacts').select('id,name,external_id,channel').eq('workspace_id',workspaceId).eq('id',c.data.contact_id).maybeSingle(),
    db.from('channel_connections').select('id,channel,status,config,secrets,external_account_id').eq('workspace_id',workspaceId).eq('id',c.data.connection_id).maybeSingle(),
  ])
  if (contact.error || connection.error || !contact.data || contact.data.channel!=='whatsapp' || !connection.data || connection.data.channel!=='whatsapp' || connection.data.status!=='connected') throw new NativeBlockError('block_unavailable')
  // Use the provider identity recorded for the contact, never a manually editable phone or a body recipient.
  const recipient=String(contact.data.external_id ?? '').replace(/^\+/,'')
  const config=connection.data.config as Record<string,unknown> | null,secrets=connection.data.secrets as Record<string,unknown> | null
  const phoneNumberId=String(config?.phone_number_id || connection.data.external_account_id || ''),encrypted=secrets?.access_token
  if (!/^\d{6,15}$/.test(recipient) || !/^\d{5,24}$/.test(phoneNumberId) || typeof encrypted!=='string' || !encrypted) throw new NativeBlockError('block_unavailable')
  let accessToken:string
  try { accessToken=decrypt(encrypted) } catch { throw new NativeBlockError('block_unavailable') }
  if (!accessToken) throw new NativeBlockError('block_unavailable')
  const fingerprint=createHash('sha256').update(JSON.stringify([workspaceId,c.data.id,contact.data.id,connection.data.id,phoneNumberId,recipient,encrypted])).digest('hex')
  return { account:{ phoneNumberId,recipient,accessToken } satisfies BlockAccount,fingerprint,name:String(contact.data.name ?? ''),businessNumber:String(config?.display_phone_number || phoneNumberId) }
}
const view=(row:Row):NativeBlockOperation => ({ id:row.id,status:row.status,desired_blocked:row.desired_blocked,expected_blocked:row.expected_blocked,created_at:row.created_at,updated_at:row.updated_at,expires_at:row.expires_at,result:row.result,review:row.review,preview:row.preview,reviewable:row.status==='uncertain' || row.status==='running' && Date.now()-Date.parse(row.updated_at)>=120000 })
export async function nativeBlockView(ctx:Context):Promise<NativeBlockView> {
  const { account,name,businessNumber }=await loadNativeBlockAccount(ctx.db,ctx.workspaceId,ctx.conversation.id)
  const [blocked,history,lock]=await Promise.all([
    nativeBlocked(account),
    ctx.db.from('inbox_native_blocks').select('*').eq('workspace_id',ctx.workspaceId).eq('phone_number_id',account.phoneNumberId).eq('recipient',account.recipient).order('created_at',{ ascending:false }).limit(20),
    ctx.db.from('inbox_native_block_locks').select('operation_id').eq('workspace_id',ctx.workspaceId).eq('phone_number_id',account.phoneNumberId).eq('recipient',account.recipient).maybeSingle(),
  ])
  if (history.error || lock.error) throw new NativeBlockError('block_unavailable')
  let active=history.data?.find(a => a.id===lock.data?.operation_id) as Row | undefined
  if (lock.data && !active) {
    const result=await ctx.db.from('inbox_native_blocks').select('*').eq('workspace_id',ctx.workspaceId).eq('id',lock.data.operation_id).maybeSingle()
    if (result.error || !result.data) throw new NativeBlockError('block_unavailable')
    active=result.data as Row
  }
  return { available:true,is_admin:ctx.isAdmin,recipient:account.recipient,phone_number_id:account.phoneNumberId,business_number:businessNumber,contact_name:name,blocked,operations:(history.data as Row[] ?? []).map(view),active_operation:active ? view(active) : null }
}
export async function changeNativeBlock(ctx:Context,input:NativeBlockInput):Promise<{ operation:NativeBlockOperation }> {
  if (!ctx.isAdmin) throw new NativeBlockContextError('native_block_admin')
  const identity=await loadNativeBlockAccount(ctx.db,ctx.workspaceId,ctx.conversation.id)
  const args={ p_id:input.id,p_workspace_id:ctx.workspaceId,p_conversation_id:ctx.conversation.id,p_actor_id:ctx.userId }
  if (input.action==='prepare') {
    const blocked=await nativeBlocked(identity.account)
    const preview={ recipient:identity.account.recipient,phone_number_id:identity.account.phoneNumberId,business_number:identity.businessNumber,contact_name:identity.name,blocked }
    const row=await rpc(ctx.db,'prepare_inbox_native_block',{ ...args,p_phone:identity.account.phoneNumberId,p_recipient:identity.account.recipient,p_desired:input.blocked,p_expected:blocked,p_fingerprint:identity.fingerprint,p_preview:preview }) as Row
    return { operation:view(row) }
  }
  const stored=await ctx.db.from('inbox_native_blocks').select('*').eq('workspace_id',ctx.workspaceId).eq('id',input.id).maybeSingle()
  const row=stored.data as Row | null
  if (stored.error || !row || row.phone_number_id!==identity.account.phoneNumberId || row.recipient!==identity.account.recipient) throw new NativeBlockContextError('invalid_native_block')
  if (input.action==='review') {
    const blocked=await nativeBlocked(identity.account)
    const reviewed=await rpc(ctx.db,'review_inbox_native_block',{ ...args,p_reason:input.reason,p_snapshot:{ blocked,recipient:identity.account.recipient,phone_number_id:identity.account.phoneNumberId,observed_at:new Date().toISOString() } }) as Row
    return { operation:view(reviewed) }
  }
  if (row.conversation_id!==ctx.conversation.id || row.actor_id!==ctx.userId) throw new NativeBlockContextError('invalid_native_block')
  // A replay returns the existing receipt through the RPC. It never issues a second provider call.
  if (row.status==='preview' && (row.fingerprint!==identity.fingerprint || await nativeBlocked(identity.account)!==row.expected_blocked)) throw new NativeBlockContextError('native_block_changed')
  const claim=await rpc(ctx.db,'claim_inbox_native_block',{ ...args,p_fingerprint:identity.fingerprint }) as { claimed:boolean;operation:Row }
  if (!claim.claimed) return { operation:view(claim.operation) }
  let dispatched=false
  let status:'completed' | 'failed' | 'uncertain'='failed',result:Record<string,unknown>={ code:'native_block_changed' }
  try {
    const fresh=await loadNativeBlockAccount(ctx.db,ctx.workspaceId,ctx.conversation.id)
    if (fresh.fingerprint!==identity.fingerprint || await nativeBlocked(fresh.account)!==row.expected_blocked) throw new NativeBlockContextError('native_block_changed')
    if (row.expected_blocked===row.desired_blocked) {
      result={ blocked:row.desired_blocked,recipient:row.recipient,phone_number_id:row.phone_number_id,already_set:true };status='completed'
    } else {
      const authorized=await rpc(ctx.db,'authorize_inbox_native_block_dispatch',args)
      if (authorized!==true) throw new NativeBlockContextError('native_block_changed')
      dispatched=true
      const receipt=await setNativeBlocked(fresh.account,row.desired_blocked)
      if (await nativeBlocked(fresh.account)!==row.desired_blocked) throw new NativeBlockError('block_uncertain')
      result={ ...receipt,phone_number_id:row.phone_number_id };status='completed'
    }
  } catch(error) {
    status=dispatched && !(error instanceof NativeBlockError && error.code==='block_rejected') ? 'uncertain' : 'failed'
    result={ code:error instanceof NativeBlockError ? error.code : 'native_block_changed',...(error instanceof NativeBlockError && error.providerCode ? { provider_code:error.providerCode } : {}) }
  }
  const finished=await rpc(ctx.db,'finish_inbox_native_block',{ p_id:input.id,p_workspace_id:ctx.workspaceId,p_status:status,p_result:result }) as Row
  return { operation:view(finished) }
}
