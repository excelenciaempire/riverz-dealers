import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { withAppsecretProof } from '@/lib/channels/meta-graph'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * Why this exists:
 *   The Settings → Message Templates UI only writes to Supabase. It does
 *   NOT submit templates for approval to Meta. Users would create a
 *   template locally, try to broadcast with it, and hit Meta's error
 *   #132001 "Template name does not exist in the translation" — because
 *   Meta had never seen the template, or had it approved under a
 *   different language code than what we stored locally.
 *
 *   This route pulls the source of truth (Meta's approved templates)
 *   and upserts them into the local catalog by (user_id, name, language).
 *   After a sync, every local template row is guaranteed to match
 *   something Meta will actually accept on send.
 *
 * Scope:
 *   - Read-only against Meta. We never push local → Meta (template
 *     submission happens in Meta's WhatsApp Manager and requires human
 *     review).
 *   - Only approved templates are surfaced by default. We return
 *     everything Meta returns and let the UI filter — so the user can
 *     see their Pending / Rejected templates and understand why.
 *   - Locally-created templates (status 'Draft', no Meta counterpart) are
 *     NOT deleted — they remain visible so the user can notice drift and
 *     clean up manually.
 *   - Meta templates from a DIFFERENT WABA are purged: templates belong to
 *     a WABA, so after switching numbers the previous WABA's templates must
 *     not linger. We stamp `waba_id` on the current WABA's templates and
 *     delete any Meta-origin row tied to another WABA.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaTemplateButton {
  type: string
  text?: string
  url?: string
  phone_number?: string
}

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaTemplateButton[]
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED'
  category: string
  /** UNKNOWN/GREEN/YELLOW/RED. UNKNOWN = plantilla nueva sin historial →
   *  elegible a pacing (retención). Meta lo devuelve como objeto o string. */
  quality_score?: string | { score?: string }
  components?: MetaTemplateComponent[]
}

/** El quality_score de Meta llega como { score: "GREEN" } o como "GREEN". */
function readQualityScore(q?: string | { score?: string }): string | null {
  if (!q) return null
  const raw = typeof q === 'string' ? q : q.score
  return raw ? String(raw).toUpperCase() : null
}

/**
 * Meta's template categories are upper-snake (MARKETING / UTILITY /
 * AUTHENTICATION); our DB CHECK constraint is TitleCase. Normalize.
 */
function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

/**
 * Meta's template status is UPPERCASE; our DB uses TitleCase.
 */
function normalizeStatus(
  meta: string,
): 'Draft' | 'Pending' | 'Approved' | 'Rejected' {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
      return 'Approved'
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'Pending'
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
      return 'Rejected'
    default:
      return 'Draft'
  }
}

export async function POST(req: Request) {
  const block = await csrfGuard(req)
  if (block) return block
  const locale = await getLocale()
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // message_templates.workspace_id is NOT NULL — resolve it so the
    // upserts below don't all fail the not-null constraint (which would
    // leave the local catalog permanently empty after a "successful" sync).
    const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
    if (!workspaceId) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.noWorkspaceResolved') },
        { status: 400 },
      )
    }

    // Resolve the WABA id + token from EITHER store. whatsapp_config
    // (user-scoped, automations) is the legacy source, but a number connected
    // via Embedded Signup writes ONLY channel_connections (workspace-scoped,
    // inbox) — so for those the user's whatsapp_config is empty and the sync
    // wrongly reported "WhatsApp no está conectado" aunque esté conectado en la
    // bandeja. Caemos a la conexión de WhatsApp del workspace.
    let wabaId: string | null = null
    let accessToken: string | null = null

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('waba_id, access_token')
      .eq('user_id', user.id)
      .maybeSingle()
    if (config?.waba_id && config.access_token) {
      wabaId = String(config.waba_id)
      accessToken = decrypt(config.access_token)
    } else {
      const { data: conn } = await supabaseAdmin()
        .from('channel_connections')
        .select('config, secrets')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'whatsapp')
        .neq('status', 'disconnected')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const cfg = (conn?.config ?? {}) as Record<string, unknown>
      const secrets = (conn?.secrets ?? {}) as Record<string, unknown>
      if (cfg.waba_id && secrets.access_token) {
        wabaId = String(cfg.waba_id)
        accessToken = decrypt(String(secrets.access_token))
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.whatsappNotConnectedSync') },
        { status: 400 },
      )
    }
    if (!wabaId) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.missingWabaIdSync') },
        { status: 400 },
      )
    }

    // Paginate through every template Meta has for this WABA. Meta
    // returns at most 100 per page; `paging.next` is a full URL. Cap
    // at 20 pages (2k templates) as a safety against infinite loops
    // from a misbehaving upstream.
    const metaTemplates: MetaTemplate[] = []
    let nextUrl:
      | string
      | null = `${META_API_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,quality_score,components`
    const PAGE_CAP = 20
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      // `paging.next` carries no appsecret_proof — re-attach each page so
      // "Require App Secret" doesn't 400 page 2+.
      const metaRes: Response = await fetch(withAppsecretProof(nextUrl, accessToken), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`
        try {
          const body = await metaRes.json()
          if (body?.error?.message) metaErr = body.error.message
        } catch {
          // response wasn't JSON — keep the fallback
        }
        return NextResponse.json({ error: metaErr }, { status: 502 })
      }

      const metaBody: {
        data?: MetaTemplate[]
        paging?: { next?: string }
      } = await metaRes.json()
      if (metaBody.data) metaTemplates.push(...metaBody.data)
      nextUrl = metaBody.paging?.next ?? null
    }

    // For each Meta template: upsert by (user_id, name, language).
    // No UNIQUE constraint on that triple, so we match manually.
    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const body = (t.components ?? []).find((c) => c.type === 'BODY')
      const header = (t.components ?? []).find((c) => c.type === 'HEADER')
      const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
      const buttonsComp = (t.components ?? []).find((c) => c.type === 'BUTTONS')
      // Conservar los botones para que la vista previa (bandeja, plantillas,
      // automatizaciones) los muestre. Meta los da con url/phone estáticos; los
      // dinámicos (url_variable) solo existen en las creadas desde Riverz.
      const syncedButtons = (buttonsComp?.buttons ?? [])
        .filter((b) => b.text?.trim())
        .map((b) => {
          const base: Record<string, unknown> = { type: b.type, text: b.text }
          if (b.url) base.url = b.url
          if (b.phone_number) base.phone_number = b.phone_number
          return base
        })

      const row = {
        user_id: user.id,
        workspace_id: workspaceId,
        waba_id: wabaId,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        header_type: header?.format?.toLowerCase() ?? null,
        header_content: header?.text ?? null,
        body_text: body?.text ?? '',
        footer_text: footer?.text ?? null,
        buttons: syncedButtons.length > 0 ? syncedButtons : null,
        status: normalizeStatus(t.status),
        // Estado crudo de Meta (preserva PAUSED/DISABLED que `status` colapsa) +
        // calidad de la plantilla (UNKNOWN = nueva, elegible a pacing).
        meta_status: t.status,
        quality_score: readQualityScore(t.quality_score),
        updated_at: new Date().toISOString(),
      }

      const { data: existing, error: lookupErr } = await supabase
        .from('message_templates')
        .select('id, buttons')
        .eq('user_id', user.id)
        .eq('name', t.name)
        .eq('language', t.language)
        .maybeSingle()

      if (lookupErr) {
        errors.push({
          name: t.name,
          language: t.language,
          message: lookupErr.message,
        })
        continue
      }

      if (existing?.id) {
        // Preservar `url_variable` de un botón URL dinámico creado en Riverz:
        // Meta lo devuelve como URL estática (dominio/{{1}}) sin esa marca, y
        // sobrescribirla dejaría al motor sin saber qué link llenar al enviar.
        const prevButtons = Array.isArray(existing.buttons)
          ? (existing.buttons as { type?: string; text?: string; url_variable?: string }[])
          : []
        if (Array.isArray(row.buttons)) {
          row.buttons = row.buttons.map((b) => {
            if ((b as { type?: string }).type !== 'URL') return b
            const prev = prevButtons.find(
              (p) => p.type === 'URL' && p.text === (b as { text?: string }).text && p.url_variable,
            )
            return prev?.url_variable ? { ...b, url_variable: prev.url_variable } : b
          })
        }
        const { error: updErr } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
        if (updErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: updErr.message,
          })
        } else {
          updated++
        }
      } else {
        const { error: insErr } = await supabase
          .from('message_templates')
          .insert(row)
        if (insErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: insErr.message,
          })
        } else {
          inserted++
        }
      }
    }

    // Purga de plantillas de OTRO WABA. Las plantillas viven a nivel de WABA
    // en Meta; al cambiar de número (nuevo WABA) las del anterior seguían
    // apareciendo porque nada las ataba a su WABA. Ya que arriba estampamos
    // `waba_id` en todas las del WABA actual, las que quedan con otro waba_id
    // (o null, de una sincronización previa al scoping) y con estado de Meta
    // (Approved/Pending/Rejected) son de un WABA viejo → se eliminan. Los
    // borradores locales (status 'Draft', sin contraparte en Meta) se
    // conservan siempre.
    let purged = 0
    const { data: purgedRows, error: purgeErr } = await supabase
      .from('message_templates')
      .delete()
      .eq('user_id', user.id)
      .neq('status', 'Draft')
      .or(`waba_id.is.null,waba_id.neq.${wabaId}`)
      .select('id')
    if (!purgeErr && purgedRows) purged = purgedRows.length

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      purged,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : translate(locale, 'errWhatsapp.syncTemplatesFailed'),
      },
      { status: 500 },
    )
  }
}
