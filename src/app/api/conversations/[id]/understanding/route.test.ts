import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),csrf:vi.fn(),budget:vi.fn(),complete:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
vi.mock('@/lib/ai/rate-limit',() => ({ aiBudgetGuard:m.budget }))
vi.mock('@/lib/ai/medido',() => ({ completeTextMedido:m.complete }))
vi.mock('@/lib/i18n/server',() => ({ getLocale:async () => 'en' }))
import { POST } from './route'
const id='11111111-1111-4111-8111-111111111111'
let rows:Record<string,unknown>[],calls:unknown[][],rowError:unknown
const row={ id,sender_type:'customer',created_at:'2026-09-30T10:00:00Z',content_text:'Order 100 costs 5.25 USD.',media_transcription:'Two medium shirts.' }
function ctx() {
  return { workspaceId:'own',userId:'user',conversation:{ id:'conv' },t:(s:string) => `localized:${s}`,db:{ from:(table:string) => {
    calls.push(['from',table]);const q={ select:(s:string) => { calls.push(['select',s]);return q },eq:(...args:unknown[]) => { calls.push(['eq',...args]);return q },is:(...args:unknown[]) => { calls.push(['is',...args]);return q },order:() => q,limit:() => q,
      maybeSingle:async () => table==='ai_agents' ? { data:{ api_key_encrypted:'workspace-key' },error:null } : { data:rows[0] ?? null,error:rowError },
      then:(resolve:(v:unknown) => unknown) => Promise.resolve({ data:rows,error:rowError }).then(resolve) };return q } } }
}
const post=(body:unknown) => POST(new Request('https://riverz.co/api/test',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) }),{ params:Promise.resolve({ id:'conv' }) })
beforeEach(() => { rows=[row];calls=[];rowError=null;m.context.mockReset().mockImplementation(async () => ctx());m.csrf.mockReset().mockResolvedValue(null);m.budget.mockReset().mockResolvedValue(null);m.complete.mockReset().mockResolvedValue('Reviewed output') })
describe('private review-only conversation understanding',() => {
  it('keeps CSRF and workspace or personal-mailbox denial ahead of model and database access',async () => {
    m.csrf.mockResolvedValue(Response.json({ error:'csrf' },{ status:403 }));expect((await post({ action:'summary' })).status).toBe(403);expect(m.context).not.toHaveBeenCalled()
    m.csrf.mockResolvedValue(null);m.context.mockResolvedValue({ response:Response.json({ error:'private' },{ status:404 }) });expect((await post({ action:'summary' })).status).toBe(404)
    expect(m.complete).not.toHaveBeenCalled();expect(calls).toEqual([])
  })
  it('fetches the exact authorized nondeleted message and returns its original without overwriting or sending it',async () => {
    const r=await post({ action:'translate_incoming',message_id:id,target:'pt' })
    expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store')
    expect(await r.json()).toMatchObject({ original:'Order 100 costs 5.25 USD.\nTwo medium shirts.',message_id:id,target:'pt' })
    expect(calls).toContainEqual(['eq','conversation_id','conv']);expect(calls).toContainEqual(['eq','id',id]);expect(calls).toContainEqual(['is','deleted_at',null])
    expect(m.complete).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ workspaceId:'own',concepto:'ia_asistencia',agentKeyEncrypted:'workspace-key' }))
  })
  it('translates only the explicit outgoing draft with no conversation fetch or send',async () => {
    const original='Amount: 5.25 USD. Not confirmed.'
    expect(await (await post({ action:'translate_outgoing',text:original,target:'es' })).json()).toMatchObject({ original,source:{ count:0 } })
    expect(calls.filter(c => c[0]==='from')).toEqual([['from','ai_agents']]);expect(m.complete.mock.calls[0][1].user).toBe(JSON.stringify({ untrusted_data:original }))
  })
  it('summarizes only this thread without changing AI memory or including team notes',async () => {
    const r=await post({ action:'summary' });expect(r.status).toBe(200)
    expect(calls.filter(c => c[0]==='from')).toEqual([['from','messages'],['from','ai_agents']])
    expect(m.complete.mock.calls[0][1].system).toContain('English');expect(m.complete.mock.calls[0][1].system).toContain('Distinguish claims')
  })
  it('summarizes cached audio without fetching arbitrary files or treating the caption as the transcript',async () => {
    expect(await (await post({ action:'audio_summary',message_id:id })).json()).toMatchObject({ original:'Two medium shirts.' })
    expect(m.complete.mock.calls[0][1].user).not.toContain('Order 100')
  })
  it('blocks empty, deleted, overlong, failed and forged source data before spending',async () => {
    rows=[];expect((await post({ action:'translate_incoming',message_id:id,target:'en' })).status).toBe(404)
    rows=[{ ...row,content_text:'',media_transcription:null }];expect((await post({ action:'summary' })).status).toBe(409)
    rows=[{ ...row,content_text:'x'.repeat(4001) }];expect((await post({ action:'translate_incoming',message_id:id,target:'en' })).status).toBe(400)
    rowError={ message:'database unavailable' };expect((await post({ action:'summary' })).status).toBe(500)
    expect((await post({ action:'summary',workspace_id:'foreign' })).status).toBe(400);expect(m.complete).not.toHaveBeenCalled()
  })
  it('respects shared AI budget and reports provider failure without pretending to have a summary',async () => {
    m.budget.mockResolvedValue(Response.json({ error:'budget' },{ status:402 }));expect((await post({ action:'summary' })).status).toBe(402);expect(m.complete).not.toHaveBeenCalled()
    m.budget.mockResolvedValue(null);m.complete.mockResolvedValue(null);expect((await post({ action:'summary' })).status).toBe(503)
  })
  it('rechecks authorization after processing before returning private content',async () => {
    m.context.mockResolvedValueOnce(ctx()).mockResolvedValueOnce({ response:Response.json({ error:'revoked' },{ status:404 }) })
    const r=await post({ action:'summary' });expect(r.status).toBe(404);expect(await r.json()).toEqual({ error:'revoked' })
  })
})
