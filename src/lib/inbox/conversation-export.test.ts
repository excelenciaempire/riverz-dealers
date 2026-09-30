import { beforeEach,describe,expect,it,vi } from 'vitest'
import { unzipSync,strFromU8 } from 'fflate'
import type { SupabaseClient } from '@supabase/supabase-js'
const m=vi.hoisted(() => ({ media:vi.fn() }))
vi.mock('./case-media',() => ({ readCaseMedia:m.media }))
import { exportConversation,exportFilename,ConversationExportLimit } from './conversation-export'
const id=(n:number) => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
const row=(n:number) => ({ id:id(n),created_at:'2026-09-30T01:00:00.000Z',sender_type:'customer',content_text:`Message ${n}`,subject:null,media_url:null,media_mime:null,media_transcription:null,attachments:[] })
let pages:unknown[][],calls:unknown[][],error:unknown
const db={ from:(table:string) => { calls.push(['from',table]);const q={ select:(s:string) => { calls.push(['select',s]);return q },eq:(...args:unknown[]) => { calls.push(['eq',...args]);return q },is:(...args:unknown[]) => { calls.push(['is',...args]);return q },lte:() => q,order:() => q,limit:() => q,or:(s:string) => { calls.push(['cursor',s]);return q },then:(resolve:(v:unknown) => unknown) => Promise.resolve({ data:pages.shift() ?? [],error }).then(resolve) };return q } } as unknown as SupabaseClient
const ctx={ workspaceId:'own',conversationId:'case',channel:'gmail',locale:'en' as const }
beforeEach(() => { pages=[[row(1)]];calls=[];error=null;m.media.mockReset().mockResolvedValue({ buffer:Buffer.from('file'),mime:'application/pdf' }) })
describe('conversation export archive',() => {
  it('produces readable text, JSON and included files, with no provider metadata, HTML or private notes',async () => {
    pages=[[{ ...row(1),content_text:'Corrected amount 5.25 USD.',media_transcription:'Voice details',attachments:[{ url:'/private',name:'invoice.pdf' }],metadata:{ secret:'provider-secret' },html_body:'<script>bad</script>' }]]
    const result=await exportConversation(db,ctx),files=unzipSync(result.archive),json=JSON.parse(strFromU8(files['conversation.json']))
    expect(result).toMatchObject({ messages:1,files:1,missing:0 });expect(Object.keys(files)).toContain('attachments/001-invoice.pdf')
    expect(json.notes_included).toBe(false);expect(json.messages[0].audio_transcripts).toEqual(['Voice details'])
    expect(strFromU8(files['conversation.txt'])).toContain('5.25 USD');expect(strFromU8(files['conversation.txt'])).toContain('Internal notes are not included')
    expect(strFromU8(files['conversation.json'])).not.toContain('/private');expect(strFromU8(files['conversation.json'])).not.toContain('provider-secret');expect(strFromU8(files['conversation.json'])).not.toContain('<script>')
    expect(calls).toContainEqual(['eq','conversation_id','case']);expect(calls).toContainEqual(['is','deleted_at',null]);expect(calls.filter(c => c[0]==='from')).toEqual([['from','messages']])
  })
  it('records inaccessible files without silently claiming they are included',async () => {
    pages=[[{ ...row(1),attachments:[{ url:'/missing',name:'photo.jpg' }] }]];m.media.mockResolvedValue(null)
    const result=await exportConversation(db,ctx),files=unzipSync(result.archive)
    expect(result).toMatchObject({ files:0,missing:1 });expect(strFromU8(files['attachments.txt'])).toContain('Unavailable')
    expect(JSON.parse(strFromU8(files['conversation.json'])).attachments[0]).toMatchObject({ path:null,status:'unavailable' })
  })
  it('uses stable keyset pages and includes the 501st row once rather than truncating at the database default',async () => {
    pages=[Array.from({ length:501 },(_,i) => row(i+1)),[row(501)]]
    const result=await exportConversation(db,ctx),json=JSON.parse(strFromU8(unzipSync(result.archive)['conversation.json']))
    expect(result.messages).toBe(501);expect(new Set(json.messages.map((r:{id:string}) => r.id)).size).toBe(501)
    expect(calls.some(c => c[0]==='cursor' && String(c[1]).includes(id(500)))).toBe(true)
  })
  it('refuses oversized text or message counts instead of returning a partial conversation',async () => {
    pages=[[{ ...row(1),content_text:'x'.repeat(11*1024*1024) }]];await expect(exportConversation(db,ctx)).rejects.toBeInstanceOf(ConversationExportLimit)
    pages=Array.from({ length:11 },(_,p) => Array.from({ length:501 },(_,i) => row(p*500+i+1)))
    await expect(exportConversation(db,ctx)).rejects.toBeInstanceOf(ConversationExportLimit);expect(m.media).not.toHaveBeenCalled()
  })
  it('caps attachment collection and reports skipped files without fetching beyond the cap',async () => {
    pages=[[{ ...row(1),attachments:Array.from({ length:101 },(_,i) => ({ url:`/file${i}` })) }]]
    const r=await exportConversation(db,ctx);expect(r).toMatchObject({ files:100,missing:1 });expect(m.media).toHaveBeenCalledTimes(100)
    const json=JSON.parse(strFromU8(unzipSync(r.archive)['conversation.json']));expect(json.attachments[100].status).toBe('limit')
  })
  it('rejects database failure and removes archive traversal and duplicate-name risks',async () => {
    error={ message:'unavailable' };await expect(exportConversation(db,ctx)).rejects.toThrow('conversation_export_read_failed')
    for (const name of ['../../secrets','C:\\private\\file.pdf','..','/root/file']) { const f=exportFilename(name,0,'application/pdf');expect(f).not.toMatch(/[\/\\]/);expect(f).not.toContain('..') }
    expect(exportFilename('same.pdf',0,'application/pdf')).not.toBe(exportFilename('same.pdf',1,'application/pdf'))
  })
})
