import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { inboxConversation } from '@/lib/inbox/server-context'
import { serverError } from '@/lib/api/errors'
import { UUID } from '@/lib/inbox/collaboration'
import { audioParts } from '@/lib/inbox/audio-parts'
import { readCaseMedia } from '@/lib/inbox/case-media'
import { aiBudgetGuard } from '@/lib/ai/rate-limit'
import { transcribeBuffer } from '@/lib/ai/transcribe'
import { resolveMime } from '@/lib/channels/media-ingest'
type Context={ params:Promise<{ id:string }> }
export async function POST(request:Request,route:Context) {
  const block=await csrfGuard(request)
  if (block) return block
  const ctx=await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  const input=await request.json().catch(() => null)
  if (!input || Object.keys(input).length!==2 || typeof input.message_id!=='string' || !UUID.test(input.message_id) || !Number.isInteger(input.index) || input.index < -1 || input.index>19) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  const row=await ctx.db.from('messages').select('id,content_type,media_url,media_mime,media_type,media_transcription,attachments').eq('id',input.message_id).eq('conversation_id',ctx.conversation.id).is('deleted_at',null).maybeSingle()
  if (row.error) return serverError(row.error,ctx.t('understandingFailed'))
  const part=row.data && audioParts(row.data).find(p => p.index===input.index)
  if (!row.data || !part) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
  if (part.text?.trim()) return NextResponse.json({ text:part.text,saved:true },{ headers:{ 'Cache-Control':'private, no-store' } })
  const over=await aiBudgetGuard(ctx.workspaceId)
  if (over) return over
  const file=await readCaseMedia(ctx.db,{ workspaceId:ctx.workspaceId,conversationId:ctx.conversation.id,channel:ctx.conversation.channel },part.url)
  if (!file) return NextResponse.json({ error:ctx.t('audioUnavailable') },{ status:409 })
  const fresh=await inboxConversation(ctx.conversation.id)
  if (fresh.response) return fresh.response
  if (fresh.workspaceId!==ctx.workspaceId) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
  const output=await transcribeBuffer(file.buffer,{ mime:resolveMime(file.mime,file.buffer,'audio'),detectLanguage:true,billing:{ db:ctx.db,workspaceId:ctx.workspaceId,concepto:'transcripcion',detalle:{ conversacion:ctx.conversation.id,mensaje:row.data.id } } })
  if (!output?.text?.trim()) return NextResponse.json({ error:ctx.t('understandingFailed') },{ status:503 })
  const after=await inboxConversation(ctx.conversation.id)
  if (after.response) return after.response
  if (after.workspaceId!==ctx.workspaceId) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
  const attachments=(row.data.attachments ?? []).map((a:Record<string,unknown>,i:number) => i===part.index ? { ...a,evidence:{ version:1,kind:'audio',text:output.text } } : a)
  const primary=part.url===row.data.media_url
  let save=ctx.db.from('messages').update({ ...(part.index>=0 ? { attachments } : {}),...(primary ? { media_transcription:output.text } : {}) })
    .eq('id',row.data.id).eq('conversation_id',ctx.conversation.id).is('deleted_at',null)
  save=row.data.media_url===null ? save.is('media_url',null) : save.eq('media_url',row.data.media_url)
  save=row.data.attachments===null ? save.is('attachments',null) : save.eq('attachments',JSON.stringify(row.data.attachments ?? []))
  save=row.data.media_transcription===null ? save.is('media_transcription',null) : save.eq('media_transcription',row.data.media_transcription)
  const saved=await save.select('id').maybeSingle()
  if (saved.error) return serverError(saved.error,ctx.t('understandingFailed'))
  return NextResponse.json({ text:output.text,saved:!!saved.data },{ headers:{ 'Cache-Control':'private, no-store' } })
}
