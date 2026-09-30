import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ sign:vi.fn(),download:vi.fn(),graph:vi.fn(),decrypt:vi.fn() }))
vi.mock('@/lib/channels/media-url',async importOriginal => ({ ...await importOriginal<object>(),signMediaPath:m.sign }))
vi.mock('@/lib/security/download-public-media',() => ({ downloadPublicMedia:m.download }))
vi.mock('@/lib/whatsapp/meta-api',() => ({ getMediaUrl:m.graph }))
vi.mock('@/lib/whatsapp/encryption',() => ({ decrypt:m.decrypt }))
import { readCaseMedia } from './case-media'
import type { SupabaseClient } from '@supabase/supabase-js'
const context={ workspaceId:'own',conversationId:'case',channel:'whatsapp' },calls:unknown[][]=[]
let config:{ data:unknown; error:unknown }
const db={ from:(table:string) => { calls.push(['from',table]);const q={ select:() => q,eq:(...args:unknown[]) => { calls.push(args);return q },maybeSingle:async () => config };return q } } as unknown as SupabaseClient
beforeEach(() => { calls.length=0;config={ data:{ access_token:'encrypted' },error:null };m.sign.mockReset().mockResolvedValue('https://storage.test/signed');m.download.mockReset().mockResolvedValue({ buffer:Buffer.from('audio'),mime:'audio/ogg' });m.graph.mockReset().mockResolvedValue({ url:'https://graph-cdn.test/real',mimeType:'audio/ogg' });m.decrypt.mockReset().mockReturnValue('synthetic-token') })
describe('case-scoped media bytes',() => {
  it('never signs an object from another account or case, traversed path or arbitrary external URL',async () => {
    for (const url of ['/api/media/other/case/file','/api/media/own/private-mailbox/file','/api/media/own/case/../file','https://169.254.169.254/secret','https://public.test/foreign','/api/channels/gmail/attachment/123']) expect(await readCaseMedia(db,context,url)).toBeNull()
    expect(m.sign).not.toHaveBeenCalled();expect(m.download).not.toHaveBeenCalled();expect(calls).toEqual([])
  })
  it('signs the authorized object briefly and uses the byte and time limits',async () => {
    expect(await readCaseMedia(db,context,'/api/media/own/case/file',1024,5000)).not.toBeNull()
    expect(m.sign).toHaveBeenCalledWith('own/case/file',60);expect(m.download).toHaveBeenCalledWith('https://storage.test/signed',1024,5000)
    m.sign.mockResolvedValue(null);m.download.mockClear();expect(await readCaseMedia(db,context,'/api/media/own/case/file')).toBeNull();expect(m.download).not.toHaveBeenCalled()
  })
  it('resolves legacy WhatsApp only with that account token and only for the WhatsApp case',async () => {
    expect(await readCaseMedia(db,context,'/api/whatsapp/media/123456',2048)).not.toBeNull()
    expect(calls).toContainEqual(['workspace_id','own']);expect(m.graph).toHaveBeenCalledWith({ mediaId:'123456',accessToken:'synthetic-token' })
    expect(m.download).toHaveBeenCalledWith('https://graph-cdn.test/real',2048,20000,{ Authorization:'Bearer synthetic-token' })
    m.graph.mockClear();expect(await readCaseMedia(db,{ ...context,channel:'gmail' },'/api/whatsapp/media/123456')).toBeNull();expect(m.graph).not.toHaveBeenCalled()
  })
  it('does not use owner or other-workspace credentials after a config failure',async () => {
    config={ data:null,error:{ message:'unavailable' } };expect(await readCaseMedia(db,context,'/api/whatsapp/media/123456')).toBeNull();expect(m.graph).not.toHaveBeenCalled();expect(m.decrypt).not.toHaveBeenCalled()
  })
})
