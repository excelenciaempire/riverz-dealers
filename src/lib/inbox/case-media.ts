import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { storagePathFromUrl,storagePathFromSegments,signMediaPath } from '@/lib/channels/media-url'
import { downloadPublicMedia } from '@/lib/security/download-public-media'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

/** The URL must come from a message fetched within the authorized case, never from request input. */
export async function readCaseMedia(db:SupabaseClient,context:{ workspaceId:string; conversationId:string; channel:string },storedUrl:string,maxBytes=25*1024*1024,timeoutMs=20000) {
  const path=storagePathFromUrl(storedUrl)
  if (path) {
    const segments=path.split('/')
    if (storagePathFromSegments(segments)!==path || segments[0]!==context.workspaceId || segments[1]!==context.conversationId) return null
    const signed=await signMediaPath(path,60)
    return signed ? downloadPublicMedia(signed,maxBytes,timeoutMs) : null
  }
  const wa=/^\/api\/whatsapp\/media\/(\d{1,40})$/.exec(storedUrl)
  if (wa && context.channel==='whatsapp') {
    const cfg=await db.from('whatsapp_config').select('access_token').eq('workspace_id',context.workspaceId).eq('status','connected').maybeSingle()
    if (cfg.error || !cfg.data?.access_token) return null
    try {
      const token=decrypt(cfg.data.access_token),media=await getMediaUrl({ mediaId:wa[1],accessToken:token })
      const file=await downloadPublicMedia(media.url,maxBytes,timeoutMs,{ Authorization:`Bearer ${token}` })
      return file ? { buffer:file.buffer,mime:media.mimeType==='application/octet-stream' ? file.mime : media.mimeType } : null
    } catch { return null }
  }
  // Do not fetch arbitrary legacy URLs, expired signatures or another channel's private proxy.
  return null
}
