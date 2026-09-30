import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { createHash } from 'node:crypto'
const mocks=vi.hoisted(() => ({ destinations:vi.fn(),platform:vi.fn(),send:vi.fn(),rpc:vi.fn(),from:vi.fn() }))
vi.mock('@/lib/avisos/destinos',() => ({ destinosDeAviso:mocks.destinations }))
vi.mock('@/lib/admin/platform-whatsapp',() => ({ platformWhatsApp:mocks.platform,sendPlatformAlert:mocks.send }))
import { caseGapNoticesEnabled,caseNoticeOutcome,notifyCaseGap } from './case-gap-notices'
const phone='15551234567',hash=createHash('sha256').update(phone).digest('hex'),notice='77777777-7777-4777-8777-777777777777'
const ctx={ db:{ rpc:mocks.rpc,from:mocks.from } as unknown as Parameters<typeof notifyCaseGap>[0]['db'],workspaceId:'workspace',userId:'actor',conversationId:'44444444-4444-4444-8444-444444444444',locale:'en' as const },request={ id:notice,gapId:'gap' }
beforeEach(() => {
 vi.clearAllMocks();vi.stubEnv('RIVERZ_CASE_QUESTION_WHATSAPP','enabled');mocks.platform.mockResolvedValue({ phoneNumberId:'platform' });mocks.destinations.mockResolvedValue([phone]);mocks.send.mockResolvedValue({ ok:true,messageId:'wamid.receipt' })
 mocks.rpc.mockImplementation(async(name:string) => ({ error:null,data:name==='reserve_case_gap_notice' ? { id:notice,resumable:true } : name==='case_gap_notice_status' ? { id:notice,accepted:1 } : true }))
 const query={ select:() => query,eq:() => query,then:(resolve:(x:unknown) => void) => resolve({ data:[{ recipient_hash:hash }],error:null }) };mocks.from.mockReturnValue(query)
})
afterEach(() => vi.unstubAllEnvs())
describe('default-off, durable internal question notices',() => {
 it.each([undefined,'','true','comparison'])('does no reservation or transport unless explicitly enabled (%s)',async(value) => {
  vi.stubEnv('RIVERZ_CASE_QUESTION_WHATSAPP',value);expect(caseGapNoticesEnabled()).toBe(false);expect(await notifyCaseGap(ctx,request)).toMatchObject({ error:{ message:'gap_notice_disabled' } });expect(mocks.platform).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled()
 })
 it('requires actual platform configuration and bounded configured recipients before reserving',async() => {
  mocks.platform.mockResolvedValue(null);expect(await notifyCaseGap(ctx,request)).toMatchObject({ error:{ message:'gap_notice_transport' } });expect(mocks.rpc).not.toHaveBeenCalled()
  mocks.platform.mockResolvedValue({});mocks.destinations.mockResolvedValue([]);expect(await notifyCaseGap(ctx,request)).toMatchObject({ error:{ message:'gap_notice_destinations' } });expect(mocks.rpc).not.toHaveBeenCalled()
  mocks.destinations.mockResolvedValue(Array.from({ length:11 },(_,i) => `15551234${i}`));expect(await notifyCaseGap(ctx,request)).toMatchObject({ error:{ message:'gap_notice_destinations' } })
 })
 it('claims before transport, sends an authenticated case link without question or customer data, and stores a real provider receipt',async() => {
  expect(await notifyCaseGap(ctx,request)).toMatchObject({ data:{ id:notice,accepted:1 } })
  expect(mocks.rpc.mock.calls.map(c => c[0])).toEqual(['reserve_case_gap_notice','claim_case_gap_notice','finish_case_gap_notice','case_gap_notice_status'])
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ to:phone,title:expect.any(String),body:expect.stringContaining(`https://riverz.co/bandeja?c=${ctx.conversationId}`) })
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_recipient_hashes:[hash] });expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(phone)
  expect(mocks.rpc.mock.calls.find(c => c[0]==='finish_case_gap_notice')![1]).toMatchObject({ p_state:'accepted',p_provider_message_id:'wamid.receipt' })
 })
 it('never retries an already claimed or uncertain transport, even if the browser asks again',async() => {
  mocks.rpc.mockImplementation(async(name:string) => ({ error:null,data:name==='reserve_case_gap_notice' ? { id:notice,resumable:true } : name==='claim_case_gap_notice' ? false : { id:notice,unconfirmed:1 } }))
  await notifyCaseGap(ctx,request);expect(mocks.send).not.toHaveBeenCalled();expect(mocks.rpc.mock.calls.some(c => c[0]==='finish_case_gap_notice')).toBe(false)
 })
 it('only returns the prior receipt for a different request, without resuming another author’s operation',async() => {
  mocks.rpc.mockImplementation(async(name:string) => ({ error:null,data:name==='reserve_case_gap_notice' ? { id:notice,resumable:false } : { id:notice,accepted:1 } }))
  await notifyCaseGap(ctx,request);expect(mocks.send).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled()
 })
 it('rechecks recipients and cancels a removed destination before transport',async() => {
  mocks.destinations.mockResolvedValueOnce([phone]).mockResolvedValueOnce([]);mocks.rpc.mockImplementation(async(name:string) => ({ error:null,data:name==='reserve_case_gap_notice' ? { id:notice,resumable:true } : name==='claim_case_gap_notice' ? false : { id:notice,cancelled:1 } }))
  await notifyCaseGap(ctx,request);expect(mocks.rpc.mock.calls.find(c => c[0]==='claim_case_gap_notice')![1]).toMatchObject({ p_destination_current:false });expect(mocks.send).not.toHaveBeenCalled()
 })
 it('does not attempt a send after an authorization or capacity conflict',async() => {
  mocks.rpc.mockResolvedValue({ data:null,error:{ message:'gap_changed' } });expect(await notifyCaseGap(ctx,request)).toMatchObject({ error:{ message:'gap_changed' } });expect(mocks.send).not.toHaveBeenCalled()
 })
 it('records a thrown transport as uncertain, without repeating it or logging private errors',async() => {
  mocks.send.mockRejectedValue(new Error('private provider detail'));await notifyCaseGap(ctx,request);expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.rpc.mock.calls.find(c => c[0]==='finish_case_gap_notice')![1]).toMatchObject({ p_state:'uncertain',p_provider_message_id:null })
 })
 it.each([[{ ok:true,messageId:'wamid.actual' },'accepted'],[{ ok:true },'uncertain'],[{ ok:false,httpStatus:400 },'rejected'],[{ ok:false,httpStatus:429 },'rejected'],[{ ok:false,httpStatus:408 },'uncertain'],[{ ok:false,httpStatus:500 },'uncertain'],[{ ok:false },'uncertain']] as const)('reports provider acceptance separately from delivery (%j)',(result,state) => {
  expect(caseNoticeOutcome(result)).toBe(state)
 })
})
