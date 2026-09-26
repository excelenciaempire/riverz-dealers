import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { downloadMedia } from '@/lib/whatsapp/media-download'
import { resolveMime } from '@/lib/channels/media-ingest'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const locale = await getLocale()
  try {
    const { mediaId } = await params

    if (!/^\d{1,40}$/.test(mediaId)) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.mediaIdRequired') },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.notAuthenticated') },
        { status: 401 }
      )
    }

    const admin = supabaseAdmin()
    const { data: memberships, error: membershipError } = await admin
      .from('workspace_members')
      .select('workspace_id, workspaces!inner(deleted_at)')
      .eq('user_id', user.id)
      .is('workspaces.deleted_at', null)
    const wsIds = (memberships ?? []).map(row => row.workspace_id as string)
    const { data: accessible, error: mediaError } = wsIds.length && !membershipError
      ? await admin.from('messages')
        .select('id, conversations!inner(workspace_id)')
        .eq('media_url', `/api/whatsapp/media/${mediaId}`)
        .in('conversations.workspace_id', wsIds)
        .limit(1).maybeSingle()
      : { data: null, error: null }
    // Provider credentials can cover multiple WABAs. Possessing a media ID
    // must never substitute for authorization to its conversation in Riverz.
    if (!accessible || mediaError || membershipError) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.mediaUnavailable') },
        { status: 404 },
      )
    }

    // Collect candidate WhatsApp tokens the caller may use: their own
    // config first, otherwise any config connected by a teammate in a
    // workspace the caller belongs to — so shared WhatsApp media isn't
    // viewable only by the agent who connected the number. Access to the
    // conversation was checked above, independently of the provider token.
    const candidates: string[] = []
    const { data: ownConfigs } = await admin
      .from('whatsapp_config')
      .select('access_token')
      .eq('user_id', user.id)
    for (const c of ownConfigs ?? []) {
      const tok = (c as { access_token?: string }).access_token
      if (tok) candidates.push(tok)
    }

    if (candidates.length === 0) {
      if (wsIds.length > 0) {
        const { data: mates } = await admin
          .from('workspace_members')
          .select('user_id')
          .in('workspace_id', wsIds)
        const userIds = [
          ...new Set(
            (mates ?? []).map((r) => (r as { user_id: string }).user_id),
          ),
        ]
        const { data: cfgs } = await admin
          .from('whatsapp_config')
          .select('access_token')
          .in('user_id', userIds)
        for (const c of cfgs ?? []) {
          const tok = (c as { access_token?: string }).access_token
          if (tok) candidates.push(tok)
        }
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.whatsappNotConfigured') },
        { status: 400 }
      )
    }

    // Try each candidate token until one resolves the media. Foreign
    // WABAs reject the media id, so the first success is the right tenant.
    let lastErr: unknown = null
    for (const enc of candidates) {
      try {
        const accessToken = decrypt(enc)
        const mediaInfo = await getMediaUrl({ mediaId, accessToken })
        const { buffer, contentType } = await downloadMedia({
          downloadUrl: mediaInfo.url,
          accessToken,
        })
        // El mime que declara Graph gana sobre el header del CDN: la CDN
        // lookaside devuelve `application/octet-stream` para muchas notas de
        // voz y con ese Content-Type el <audio> del inbox no reproduce. Si
        // ninguno de los dos sirve, deciden los bytes (resolveMime).
        const declared =
          mediaInfo.mimeType && mediaInfo.mimeType !== 'application/octet-stream'
            ? mediaInfo.mimeType
            : null
        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            'Content-Type': resolveMime(declared || contentType, buffer),
            'Cache-Control': 'private, max-age=86400',
          },
        })
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr ?? new Error('media fetch failed')
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: translate(locale, 'errWhatsapp.fetchMediaFailed') },
      { status: 500 }
    )
  }
}
