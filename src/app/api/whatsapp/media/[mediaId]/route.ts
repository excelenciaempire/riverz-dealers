import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
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
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Collect candidate WhatsApp tokens the caller may use: their own
    // config first, otherwise any config connected by a teammate in a
    // workspace the caller belongs to — so shared WhatsApp media isn't
    // viewable only by the agent who connected the number. A token from
    // another tenant can't fetch this media id anyway (Meta scopes media
    // to the WABA), so this never leaks across workspaces.
    const admin = supabaseAdmin()
    const candidates: string[] = []
    const { data: ownConfig } = await admin
      .from('whatsapp_config')
      .select('access_token')
      .eq('user_id', user.id)
      .maybeSingle()
    if (ownConfig?.access_token) candidates.push(ownConfig.access_token as string)

    if (candidates.length === 0) {
      const { data: myWs } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
      const wsIds = (myWs ?? []).map(
        (r) => (r as { workspace_id: string }).workspace_id,
      )
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
        { error: 'WhatsApp not configured' },
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
        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            'Content-Type':
              contentType || mediaInfo.mimeType || 'application/octet-stream',
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
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
