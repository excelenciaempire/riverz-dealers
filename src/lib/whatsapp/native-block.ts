import 'server-only'
import { withAppsecretProof } from '@/lib/channels/meta-graph'
export type BlockAccount={ phoneNumberId:string;accessToken:string;recipient:string }
export class NativeBlockError extends Error {
  constructor(readonly code:'block_unavailable' | 'block_rejected' | 'block_uncertain',readonly providerCode?:number) { super(code) }
}
const graph='https://graph.facebook.com/v22.0'
function endpoint(account:BlockAccount) {
  if (!/^\d{5,24}$/.test(account.phoneNumberId) || !/^\d{6,15}$/.test(account.recipient) || !account.accessToken) throw new NativeBlockError('block_unavailable')
  return `${graph}/${account.phoneNumberId}/block_users`
}
type RecordValue=Record<string,unknown>
const record=(v:unknown):RecordValue | null => v && typeof v==='object' && !Array.isArray(v) ? v as RecordValue : null
/** Read the exact provider list. A bounded/incomplete list never proves absence. */
export async function nativeBlocked(account:BlockAccount):Promise<boolean> {
  const base=endpoint(account),seen=new Set<string>(),deadline=Date.now()+25000
  let after:string | undefined
  for (let page=0;page<100;page++) {
    if (Date.now()>=deadline) throw new NativeBlockError('block_unavailable')
    const url=new URL(base);url.searchParams.set('limit','100');if (after) url.searchParams.set('after',after)
    let r:Response
    try { r=await fetch(withAppsecretProof(url.toString(),account.accessToken),{ headers:{ Authorization:`Bearer ${account.accessToken}` },cache:'no-store',redirect:'error',signal:AbortSignal.timeout(Math.min(10000,deadline-Date.now())) }) }
    catch { throw new NativeBlockError('block_unavailable') }
    const json=record(await r.json().catch(() => null))
    if (!r.ok || !Array.isArray(json?.data)) throw new NativeBlockError('block_unavailable',Number(record(json?.error)?.code) || undefined)
    for (const item of json.data) {
      const value=record(item)
      // Unsupported identity formats fail closed instead of silently declaring an unblocked user.
      if (value?.messaging_product!=='whatsapp' || typeof value.wa_id!=='string' || !/^\d{6,15}$/.test(value.wa_id)) throw new NativeBlockError('block_unavailable')
      if (value.wa_id===account.recipient) return true
    }
    const paging=record(json.paging)
    if (!paging?.next) return false
    const cursor=record(paging.cursors)?.after
    if (typeof cursor!=='string' || !cursor || cursor.length>4096 || seen.has(cursor)) throw new NativeBlockError('block_unavailable')
    // Never follow provider next URLs with an Authorization header. Rebuild the fixed endpoint.
    seen.add(cursor);after=cursor
  }
  throw new NativeBlockError('block_unavailable')
}
/** One request only. HTTP 200 is insufficient; require the exact per-user receipt. */
export async function setNativeBlocked(account:BlockAccount,blocked:boolean):Promise<{ blocked:boolean;recipient:string }> {
  const url=endpoint(account)
  let r:Response
  try {
    r=await fetch(withAppsecretProof(url,account.accessToken),{ method:blocked ? 'POST' : 'DELETE',headers:{ Authorization:`Bearer ${account.accessToken}`,'Content-Type':'application/json' },body:JSON.stringify({ messaging_product:'whatsapp',block_users:[{ user:`+${account.recipient}` }] }),redirect:'error',signal:AbortSignal.timeout(15000) })
  } catch { throw new NativeBlockError('block_uncertain') }
  const json=record(await r.json().catch(() => null))
  if (!r.ok) {
    // Explicit 4xx rejection has no receipt. Server failures cannot prove no effect.
    throw new NativeBlockError(r.status>=400 && r.status<500 ? 'block_rejected' : 'block_uncertain',Number(record(json?.error)?.code) || undefined)
  }
  const receipt=record(json?.block_users),users=receipt?.[blocked ? 'added_users' : 'removed_users']
  if (json?.messaging_product==='whatsapp' && Array.isArray(users) && users.length===1) {
    const user=record(users[0])
    if (user?.input===`+${account.recipient}` && user.wa_id===account.recipient) return { blocked,recipient:account.recipient }
  }
  // Per-user failures can be returned under HTTP 200. Only an explicit exact failure proves rejection.
  const failed=receipt?.failed_users
  if (Array.isArray(failed) && failed.length===1 && record(failed[0])?.input===`+${account.recipient}` && !Array.isArray(users)) throw new NativeBlockError('block_rejected')
  throw new NativeBlockError('block_uncertain')
}
