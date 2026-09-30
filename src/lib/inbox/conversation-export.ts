import 'server-only'
import { zipSync,strToU8 } from 'fflate'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readCaseMedia } from './case-media'
import { audioTranscripts } from './understanding'
import type { Locale } from '@/lib/i18n/config'
import { translate } from '@/lib/i18n/translate'
import { formatDateTime } from '@/lib/i18n/format'
const MAX_MESSAGES=5000,MAX_FILES=100,MAX_BYTES=50*1024*1024,MAX_TEXT=10*1024*1024
export class ConversationExportLimit extends Error { constructor() { super('conversation_export_limit') } }
interface ExportMessage { id:string; sender_type:string; content_text?:string | null; subject?:string | null; media_url?:string | null; media_mime?:string | null; created_at:string; media_transcription?:string | null;
  attachments?:{ url:string; name?:string; mime_type?:string; evidence?:{ version:number; kind:string; text:string } }[] | null }
export function exportFilename(raw:string | undefined,index:number,mime:string | undefined):string {
  const clean=(raw ?? '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.{2,}/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,100)
  const ext:Record<string,string>={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf','audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a','video/mp4':'mp4' }
  return `${String(index+1).padStart(3,'0')}-${clean || `attachment.${ext[mime ?? ''] ?? 'bin'}`}`
}
/** Only known public message fields are exported. Provider metadata, credentials and private notes never enter this query. */
export async function exportConversation(db:SupabaseClient,context:{ workspaceId:string; conversationId:string; channel:string; locale:Locale }) {
  const cutoff=new Date().toISOString(),rows:ExportMessage[]=[]
  let cursor:{ created_at:string; id:string } | undefined,textBytes=0
  for (;;) {
    let q=db.from('messages').select('id,sender_type,content_text,subject,media_url,media_mime,created_at,media_transcription,attachments')
      .eq('conversation_id',context.conversationId).is('deleted_at',null).lte('created_at',cutoff)
      .order('created_at',{ ascending:true }).order('id',{ ascending:true }).limit(501)
    if (cursor) q=q.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`)
    const page=await q
    if (page.error) throw new Error('conversation_export_read_failed')
    const found=(page.data ?? []) as ExportMessage[],batch=found.slice(0,500)
    for (const row of batch) textBytes+=Buffer.byteLength(JSON.stringify({ text:row.content_text,subject:row.subject,audio:audioTranscripts(row) }))
    if (rows.length+batch.length>MAX_MESSAGES || textBytes>MAX_TEXT) throw new ConversationExportLimit()
    rows.push(...batch)
    if (found.length<=500) break
    const last=batch.at(-1)!
    if (!/^[0-9a-f-]{36}$/i.test(last.id) || !Number.isFinite(Date.parse(last.created_at))) throw new Error('conversation_export_cursor_invalid')
    if (cursor?.id===last.id) throw new Error('conversation_export_cursor_stalled')
    cursor={ created_at:last.created_at,id:last.id }
  }
  const files:Record<string,Uint8Array>={},manifest:{ message_id:string; name:string; path:string | null; status:'included' | 'unavailable' | 'limit' }[]=[]
  let bytes=0,fileCount=0
  const deadline=Date.now()+50000
  const messages=rows.map(row => ({ id:row.id,sender:row.sender_type,at:row.created_at,subject:row.subject ?? null,text:row.content_text ?? null,audio_transcripts:audioTranscripts(row) }))
  for (const row of rows) {
    const attachments=[...(row.attachments ?? [])]
    if (row.media_url && !attachments.some(a => a.url===row.media_url)) attachments.unshift({ url:row.media_url,mime_type:row.media_mime ?? undefined })
    for (const a of attachments) {
      if (manifest.length>=1000) throw new ConversationExportLimit()
      const name=exportFilename(a.name,manifest.length,a.mime_type),entry:{ message_id:string; name:string; path:string | null; status:'included' | 'unavailable' | 'limit' }={ message_id:row.id,name,path:null,status:'unavailable' }
      if (++fileCount>MAX_FILES || Date.now()>deadline || MAX_BYTES-bytes<=0) entry.status='limit'
      else {
        const file=await readCaseMedia(db,context,a.url,Math.min(25*1024*1024,MAX_BYTES-bytes),10000).catch(() => null)
        if (file) { const path=`attachments/${name}`;files[path]=new Uint8Array(file.buffer);bytes+=file.buffer.length;entry.path=path;entry.status='included' }
      }
      manifest.push(entry)
    }
  }
  const t=(key:string) => translate(context.locale,`inbox.${key}`)
  const text=messages.map(m => `${formatDateTime(m.at,context.locale)} · ${t(m.sender==='customer' ? 'exportCustomer' : m.sender==='bot' ? 'exportAssistant' : 'exportTeam')}\n${[m.subject,m.text,...m.audio_transcripts].filter(Boolean).join('\n')}`).join('\n\n')
  files['conversation.txt']=strToU8(`${t('exportTitle')}\n${context.channel}\n\n${text}\n\n${t('exportNotesExcluded')}\n${t('exportMissingFiles')}\n`)
  files['conversation.json']=strToU8(JSON.stringify({ version:1,conversation_id:context.conversationId,channel:context.channel,exported_at:cutoff,notes_included:false,messages,attachments:manifest },null,2))
  files['attachments.txt']=strToU8(manifest.map(a => `${a.message_id}\t${a.name}\t${t(a.status==='included' ? 'exportIncluded' : a.status==='limit' ? 'exportAttachmentLimit' : 'exportUnavailable')}`).join('\n'))
  return { archive:zipSync(files,{ level:0 }),messages:messages.length,files:manifest.filter(a => a.status==='included').length,missing:manifest.filter(a => a.status!=='included').length }
}
