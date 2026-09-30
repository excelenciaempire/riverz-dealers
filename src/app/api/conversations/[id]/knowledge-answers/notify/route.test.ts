import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(() => ({ context:vi.fn(),csrf:vi.fn(),enabled:vi.fn(),notify:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:mocks.context }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:mocks.csrf }))
vi.mock('@/lib/i18n/server',() => ({ getLocale:async() => 'en' }))
vi.mock('@/lib/i18n/translate',() => ({ translate:(_locale:string,key:string) => key }))
vi.mock('@/lib/ai/gap-knowledge-server',() => ({ gapHeaders:{ 'Cache-Control':'private, no-store' },gapError:(e:{message:string}) => Response.json({ error:e.message },{ status:404 }) }))
vi.mock('@/lib/ai/case-gap-notices',() => ({ caseGapNoticesEnabled:mocks.enabled,notifyCaseGap:mocks.notify }))
import { POST } from './route'
const conversation='44444444-4444-4444-8444-444444444444',gap='55555555-5555-4555-8555-555555555555',receipt='77777777-7777-4777-8777-777777777777',ctx={ db:{},workspaceId:'active-workspace',userId:'authenticated-actor' },params={ params:Promise.resolve({ id:conversation }) },input={ id:receipt,gap_id:gap }
const request=(body:unknown=input) => POST(new Request('https://riverz.co/',{ method:'POST',body:JSON.stringify(body) }),params)
beforeEach(() => { vi.clearAllMocks();mocks.context.mockResolvedValue(ctx);mocks.csrf.mockResolvedValue(null);mocks.enabled.mockReturnValue(true);mocks.notify.mockResolvedValue({ data:{ id:receipt,accepted:1 },error:null }) })
describe('explicitly enabled, authorized internal WhatsApp notice API',() => {
 it('keeps the new outbound feature disabled without reserving or sending',async() => {
  mocks.enabled.mockReturnValue(false);expect((await request()).status).toBe(409);expect(mocks.notify).not.toHaveBeenCalled()
 })
 it('uses only the authenticated workspace, actor and live case, returning a provider-status receipt without caching',async() => {
  const r=await request();expect(r.status).toBe(200);expect(await r.json()).toEqual({ receipt:{ id:receipt,accepted:1 } });expect(r.headers.get('Cache-Control')).toContain('no-store')
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({ ...ctx,conversationId:conversation,locale:'en' },{ id:receipt,gapId:gap })
 })
 it('rejects forged actor, workspace, recipient or source identifiers before transport',async() => {
  for (const body of [{ ...input,to:'someone' },{ ...input,actor_id:'forged' },{ ...input,workspace_id:'foreign' },{ ...input,gap_id:'invalid' }]) expect((await request(body)).status).toBe(400)
  expect(mocks.notify).not.toHaveBeenCalled()
 })
 it.each(['gap_notice_limit','gap_notice_destinations','gap_notice_transport'])('reports configuration or capacity failures without pretending a notice was sent (%s)',async(message) => {
  mocks.notify.mockResolvedValue({ data:null,error:{ message } });expect((await request()).status).toBe(409);expect(mocks.notify).toHaveBeenCalledTimes(1)
 })
 it('preserves CSRF and case access denials before attempting notification work',async() => {
  mocks.csrf.mockResolvedValue(Response.json({}, { status:403 }));expect((await request()).status).toBe(403);expect(mocks.context).not.toHaveBeenCalled()
  mocks.csrf.mockResolvedValue(null);mocks.context.mockResolvedValue({ response:Response.json({}, { status:404 }) });expect((await request()).status).toBe(404);expect(mocks.notify).not.toHaveBeenCalled()
 })
})
