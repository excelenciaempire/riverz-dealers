export interface AudioMessage { media_url?:string | null; media_mime?:string | null; media_type?:string | null; content_type?:string | null; media_transcription?:string | null;
  attachments?:{ url:string; mime_type?:string; name?:string; evidence?:{ version:number; kind:string; text:string } }[] | null }
export function audioParts(row:AudioMessage) {
  const parts:{ index:number; url:string; name?:string; text:string | null }[]=[]
  const isAudio=(mime:string | undefined,url:string) => /^(audio(?:\/|$)|voice$)/i.test(mime ?? '') || /\.(ogg|oga|opus|mp3|m4a|aac|amr|wav|weba|flac|3ga)(?:[?#]|$)/i.test(url)
  for (const [index,a] of (row.attachments ?? []).entries()) {
    const primary=a.url===row.media_url
    if (!isAudio(a.mime_type ?? (primary ? row.media_mime ?? undefined : undefined),a.url) && !(primary && /^(audio|voice)$/.test(row.media_type ?? row.content_type ?? ''))) continue
    parts.push({ index,url:a.url,name:a.name,text:a.evidence?.version===1 && a.evidence.kind==='audio' ? a.evidence.text : primary ? row.media_transcription ?? null : null })
  }
  if (row.media_url && !parts.some(a => a.url===row.media_url) && (isAudio(row.media_mime ?? undefined,row.media_url) || /^(audio|voice)$/.test(row.media_type ?? row.content_type ?? ''))) parts.unshift({ index:-1,url:row.media_url,text:row.media_transcription ?? null })
  return parts
}
