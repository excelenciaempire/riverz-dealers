import { beforeEach,describe,expect,it,vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const m=vi.hoisted(() => ({ blocked:vi.fn(),set:vi.fn(),decrypt:vi.fn() }))
vi.mock('@/lib/channels/encryption',() => ({ decrypt:m.decrypt }))
vi.mock('@/lib/whatsapp/native-block',async importOriginal => ({ ...await importOriginal<object>(),nativeBlocked:m.blocked,setNativeBlocked:m.set }))
import { changeNativeBlock,loadNativeBlockAccount } from './native-block-server'
import { NativeBlockError } from '@/lib/whatsapp/native-block'
import { nativeBlockInput } from './native-block-contract'
const id='11111111-1111-4111-8111-111111111111'
function setup() {
  let row:Record<string,unknown> | null=null
  const calls:Array<{ table:string;filters:Array<unknown> }>=[]
  const rpc=vi.fn(async(name:string,args:Record<string,unknown>) => {
    if (name==='prepare_inbox_native_block') row={ id,status:'preview',workspace_id:'ws',conversation_id:'case',actor_id:'user',desired_blocked:args.p_desired,expected_blocked:args.p_expected,fingerprint:args.p_fingerprint,phone_number_id:args.p_phone,recipient:args.p_recipient,preview:args.p_preview,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),result:null,review:null }
    if (name==='claim_inbox_native_block') {
      const claimed=row?.status==='preview';if (claimed) row={ ...row,status:'running' };return { data:{ claimed,operation:row },error:null }
    }
    if (name==='authorize_inbox_native_block_dispatch') return { data:true,error:null }
    if (name==='finish_inbox_native_block') row={ ...row,status:args.p_status,result:args.p_result }
    if (name==='review_inbox_native_block') row={ ...row,status:'reviewed',review:{ reason:args.p_reason,snapshot:args.p_snapshot } }
    return { data:row,error:null }
  })
  const data:Record<string,unknown>={ conversations:{ id:'case',channel:'whatsapp',contact_id:'contact',connection_id:'connection' },contacts:{ id:'contact',channel:'whatsapp',name:'Customer',external_id:'16505551234',phone:'16505559999' },channel_connections:{ id:'connection',channel:'whatsapp',status:'connected',config:{ phone_number_id:'123456789' },secrets:{ access_token:'cipher' } } }
  const db={ rpc,from(table:string) {
    const call={ table,filters:[] as unknown[] };calls.push(call)
    return { select(){ return this },eq(...args:unknown[]){ call.filters.push(args);return this },is(...args:unknown[]){ call.filters.push(args);return this },async maybeSingle(){ return { data:table==='inbox_native_blocks' ? row : data[table],error:null } } }
  } } as unknown as SupabaseClient
  return { ctx:{ db,workspaceId:'ws',userId:'user',isAdmin:true,conversation:{ id:'case' } },rpc,calls,data,getRow:() => row }
}
beforeEach(() => { vi.clearAllMocks();m.decrypt.mockReturnValue('token');m.blocked.mockResolvedValue(false);m.set.mockResolvedValue({ blocked:true,recipient:'16505551234' }) })
describe('reviewed native blocking service',() => {
  it('rejects caller-provided recipients and authority overrides',() => {
    const input={ id,action:'prepare',blocked:true }
    expect(nativeBlockInput(input)).toEqual(input)
    for (const extra of ['recipient','phone_number_id','workspace_id','user_id']) expect(nativeBlockInput({ ...input,[extra]:'override' })).toBeNull()
  })
  it('prepares without provider mutation, using the recorded external identity and exact workspace',async() => {
    const f=setup(),result=await changeNativeBlock(f.ctx,{ id,action:'prepare',blocked:true })
    expect(result.operation.preview.recipient).toBe('16505551234');expect(m.set).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('token');expect(JSON.stringify(result)).not.toContain('fingerprint')
    for (const call of f.calls) expect(call.filters).toContainEqual(['workspace_id','ws'])
  })
  it('denies nonadministrators and unsupported/foreign sources before provider IO',async() => {
    const f=setup();await expect(changeNativeBlock({ ...f.ctx,isAdmin:false },{ id,action:'prepare',blocked:true })).rejects.toMatchObject({ code:'native_block_admin' })
    expect(f.calls).toHaveLength(0)
    f.data.contacts={ id:'contact',channel:'gmail',external_id:'16505551234' };await expect(loadNativeBlockAccount(f.ctx.db,'ws','case')).rejects.toMatchObject({ code:'block_unavailable' });expect(m.blocked).not.toHaveBeenCalled()
  })
  it('executes once with an exact receipt and fresh state, and replays only the stored result',async() => {
    const f=setup();await changeNativeBlock(f.ctx,{ id,action:'prepare',blocked:true })
    m.blocked.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true)
    const first=await changeNativeBlock(f.ctx,{ id,action:'execute' });expect(first.operation.status).toBe('completed')
    const retry=await changeNativeBlock(f.ctx,{ id,action:'execute' });expect(retry.operation.result).toEqual(first.operation.result);expect(m.set).toHaveBeenCalledTimes(1)
    expect(f.rpc.mock.calls.map(call => call[0])).toContain('authorize_inbox_native_block_dispatch')
  })
  it('rejects a changed state before claim and a changed connection after claim without mutation',async() => {
    const f=setup();await changeNativeBlock(f.ctx,{ id,action:'prepare',blocked:true });m.blocked.mockResolvedValue(true)
    await expect(changeNativeBlock(f.ctx,{ id,action:'execute' })).rejects.toMatchObject({ code:'native_block_changed' });expect(m.set).not.toHaveBeenCalled()
    m.blocked.mockResolvedValue(false)
    const original=f.rpc.getMockImplementation()!
    f.rpc.mockImplementation(async(name,args) => { const result=await original(name,args);if (name==='claim_inbox_native_block') f.data.channel_connections={ ...(f.data.channel_connections as object),status:'disconnected' };return result })
    expect((await changeNativeBlock(f.ctx,{ id,action:'execute' })).operation.status).toBe('failed');expect(m.set).not.toHaveBeenCalled()
  })
  it('persists uncertainty on lost response, never resending and reviews the observed state',async() => {
    const f=setup();await changeNativeBlock(f.ctx,{ id,action:'prepare',blocked:true });m.set.mockRejectedValue(new NativeBlockError('block_uncertain'))
    expect((await changeNativeBlock(f.ctx,{ id,action:'execute' })).operation.status).toBe('uncertain')
    await changeNativeBlock(f.ctx,{ id,action:'execute' });expect(m.set).toHaveBeenCalledTimes(1)
    m.blocked.mockResolvedValue(true);expect((await changeNativeBlock(f.ctx,{ id,action:'review',reason:'Checked current state' })).operation.status).toBe('reviewed')
    expect(f.rpc).toHaveBeenCalledWith('review_inbox_native_block',expect.objectContaining({ p_snapshot:expect.objectContaining({ blocked:true,recipient:'16505551234' }) }))
  })
  it('records explicit provider rejection as not applied',async() => {
    const f=setup();await changeNativeBlock(f.ctx,{ id,action:'prepare',blocked:true });m.set.mockRejectedValue(new NativeBlockError('block_rejected',100))
    const result=await changeNativeBlock(f.ctx,{ id,action:'execute' });expect(result.operation.status).toBe('failed');expect(result.operation.result).toEqual({ code:'block_rejected',provider_code:100 })
  })
})
