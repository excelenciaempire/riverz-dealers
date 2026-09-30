import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),csrf:vi.fn(),budget:vi.fn(),media:vi.fn(),transcribe:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
vi.mock('@/lib/inbox/case-media',() => ({ readCaseMedia:m.media }))
vi.mock('@/lib/ai/rate-limit',() => ({ aiBudgetGuard:m.budget }))
vi.mock('@/lib/ai/transcribe',() => ({ transcribeBuffer:m.transcribe }))
vi.mock('@/lib/channels/media-ingest',() => ({ resolveMime:() => 'audio/ogg' }))
import { POST } from './route'
const id='11111111-1111-4111-8111-111111111111'
const base={ id,media_url:'/api/media/own/case/audio.ogg',media_type:'voice',media_mime:'audio/ogg',media_transcription:null,attachments:null }
let row:Record<string,unknown> | null,calls:unknown[][],saveData:unknown,rowError:unknown
function context() { return { workspaceId:'own',userId:'user',conversation:{ id:'case',channel:'whatsapp' },t:(s:string) => `localized:${s}`,db:{ from:(table:string) => {
  calls.push(['from',table]);let updating=false
  const q={ select:() => q,eq:(...a:unknown[]) => { calls.push(['eq',...a]);return q },is:(...a:unknown[]) => { calls.push(['is',...a]);return q },update:(v:unknown) => { updating=true;calls.push(['update',v]);return q },maybeSingle:async () => ({ data:updating ? saveData : row,error:rowError }) };return q
} } } }
const post=(body:unknown={ message_id:id,index:-1 }) => POST(new Request('https://riverz.co/api/transcribe',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) }),{ params:Promise.resolve({ id:'case' }) })
beforeEach(() => { row={ ...base };calls=[];saveData={ id };rowError=null;m.context.mockReset().mockImplementation(async () => context());m.csrf.mockReset().mockResolvedValue(null);m.budget.mockReset().mockResolvedValue(null);m.media.mockReset().mockResolvedValue({ buffer:Buffer.from('audio'),mime:'audio/ogg' });m.transcribe.mockReset().mockResolvedValue({ text:'Actual transcription',language:'en' }) })
describe('authorized on-demand transcription',() => {
  it('keeps CSRF, private mailbox and exact source access ahead of downloads and spend',async () => {
    m.csrf.mockResolvedValue(Response.json({ error:'csrf' },{ status:403 }));expect((await post()).status).toBe(403);expect(m.context).not.toHaveBeenCalled()
    m.csrf.mockResolvedValue(null);m.context.mockResolvedValue({ response:Response.json({ error:'private' },{ status:404 }) });expect((await post()).status).toBe(404)
    expect(m.media).not.toHaveBeenCalled();expect(m.transcribe).not.toHaveBeenCalled()
  })
  it('does not let the body select a URL, another account or a nonexistent attachment',async () => {
    expect((await post({ message_id:id,index:-1,url:'https://foreign' })).status).toBe(400)
    expect((await post({ message_id:id,index:20 })).status).toBe(400);expect((await post({ message_id:id,index:0 })).status).toBe(404)
    row=null;expect((await post()).status).toBe(404);expect(m.media).not.toHaveBeenCalled()
  })
  it('returns an existing transcript without another paid request',async () => {
    row={ ...base,media_transcription:'Already understood' };expect(await (await post()).json()).toEqual({ text:'Already understood',saved:true });expect(m.budget).not.toHaveBeenCalled();expect(m.media).not.toHaveBeenCalled();expect(m.transcribe).not.toHaveBeenCalled()
  })
  it('detects language and conditionally saves only the exact authorized unchanged message',async () => {
    expect(await (await post()).json()).toEqual({ text:'Actual transcription',saved:true })
    expect(calls).toContainEqual(['eq','conversation_id','case']);expect(calls).toContainEqual(['eq','id',id]);expect(calls).toContainEqual(['is','deleted_at',null]);expect(calls).toContainEqual(['is','attachments',null]);expect(calls).toContainEqual(['is','media_transcription',null])
    expect(calls).toContainEqual(['update',{ media_transcription:'Actual transcription' }]);expect(m.transcribe).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ detectLanguage:true,billing:expect.objectContaining({ workspaceId:'own' }) }))
    expect(calls).toContainEqual(['eq','media_url',base.media_url])
  })
  it('updates one audio attachment without replacing other cached evidence and reports a concurrent change',async () => {
    const attachments=[{ url:'/image',mime_type:'image/jpeg',evidence:{ version:1,kind:'image',text:'Image details' } },{ url:'/api/media/own/case/second.ogg',mime_type:'audio/ogg' }]
    row={ ...base,attachments };saveData=null
    expect(await (await post({ message_id:id,index:1 })).json()).toEqual({ text:'Actual transcription',saved:false })
    expect(calls).toContainEqual(['eq','attachments',JSON.stringify(attachments)])
    const update=calls.find(c => c[0]==='update')![1] as { attachments:unknown[] };expect(update.attachments[0]).toEqual(attachments[0]);expect(update.attachments[1]).toMatchObject({ evidence:{ text:'Actual transcription' } })
  })
  it('stops for budget, inaccessible bytes or unavailable transcription',async () => {
    m.budget.mockResolvedValue(Response.json({ error:'budget' },{ status:402 }));expect((await post()).status).toBe(402);expect(m.media).not.toHaveBeenCalled()
    m.budget.mockResolvedValue(null);m.media.mockResolvedValue(null);expect((await post()).status).toBe(409);expect(m.transcribe).not.toHaveBeenCalled()
    m.media.mockResolvedValue({ buffer:Buffer.from('audio'),mime:'audio/ogg' });m.transcribe.mockResolvedValue(null);expect((await post()).status).toBe(503);expect(calls.some(c => c[0]==='update')).toBe(false)
  })
  it('rechecks access before processing and before saving or returning the result',async () => {
    m.context.mockResolvedValueOnce(context()).mockResolvedValueOnce({ response:Response.json({ error:'revoked' },{ status:404 }) });expect((await post()).status).toBe(404);expect(m.transcribe).not.toHaveBeenCalled()
    m.context.mockResolvedValueOnce(context()).mockResolvedValueOnce(context()).mockResolvedValueOnce({ response:Response.json({ error:'revoked' },{ status:404 }) });expect((await post()).status).toBe(404);expect(calls.some(c => c[0]==='update')).toBe(false)
  })
})
