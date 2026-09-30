import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),export:vi.fn(),limit:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/inbox/conversation-export',() => ({ exportConversation:m.export,ConversationExportLimit:class extends Error {} }))
vi.mock('@/lib/i18n/server',() => ({ getLocale:async () => 'en' }))
vi.mock('@/lib/rate-limit',() => ({ limitByKey:m.limit,rateLimitResponse:() => Response.json({ error:'limit' },{ status:429 }) }))
import { GET } from './route'
import { ConversationExportLimit } from '@/lib/inbox/conversation-export'
const ctx={ db:{},workspaceId:'own',userId:'user',conversation:{ id:'case',channel:'gmail' },t:(s:string) => `localized:${s}` }
const get=() => GET(new Request('https://riverz.co/api/export'),{ params:Promise.resolve({ id:'case' }) })
beforeEach(() => { m.context.mockReset().mockResolvedValue(ctx);m.limit.mockReset().mockResolvedValue({ success:true });m.export.mockReset().mockResolvedValue({ archive:new Uint8Array([1,2,3]),messages:2,files:1,missing:1 }) })
describe('authorized private archive download',() => {
  it('does not export a foreign case or private mailbox denied by context',async () => {
    m.context.mockResolvedValue({ response:Response.json({ error:'private' },{ status:404 }) });expect((await get()).status).toBe(404);expect(m.export).not.toHaveBeenCalled();expect(m.limit).not.toHaveBeenCalled()
  })
  it('returns an uncached ZIP with exact inclusion counts',async () => {
    const r=await get();expect(r.status).toBe(200);expect(r.headers.get('content-type')).toBe('application/zip');expect(r.headers.get('cache-control')).toBe('private, no-store');expect(r.headers.get('x-export-missing')).toBe('1')
    expect(m.export).toHaveBeenCalledWith(ctx.db,{ workspaceId:'own',conversationId:'case',channel:'gmail',locale:'en' })
  })
  it('does not return the archive after membership revocation or selected workspace change',async () => {
    m.context.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ response:Response.json({ error:'revoked' },{ status:404 }) });expect((await get()).status).toBe(404)
    m.context.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ ...ctx,workspaceId:'other' });expect((await get()).status).toBe(404)
  })
  it('enforces export rate limits and reports limits and failures in the UI language',async () => {
    m.limit.mockResolvedValue({ success:false });expect((await get()).status).toBe(429);expect(m.export).not.toHaveBeenCalled()
    m.limit.mockResolvedValue({ success:true });m.export.mockRejectedValue(new ConversationExportLimit());expect(await (await get()).json()).toEqual({ error:'localized:exportLimit' })
    m.export.mockRejectedValue(new Error('database'));expect((await get()).status).toBe(500)
  })
})
