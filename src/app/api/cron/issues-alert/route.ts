import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { collectWorkspaceIssues, type Issue } from '@/lib/health/issues'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.issues-alert')

/**
 * El aviso que va a buscar al comercio.
 *
 * La tarjeta de Inicio sólo sirve si alguien entra a mirar, y los problemas que
 * importan son justo los que nadie mira: un envío que no salió no genera
 * ninguna señal en la pantalla. Una vez por día, si hay algo roto, sale un
 * correo al dueño del workspace.
 *
 * Una vez por día y sin ledger a propósito: la frecuencia ES la deduplicación.
 * Si el problema sigue mañana, el correo vuelve — que es lo correcto, porque
 * sigue roto. Y no hace falta ninguna tabla nueva que mantener al día.
 */
const MAX_WORKSPACES = 50

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('workspaces')
    .select('id, name, owner_id')
    .limit(MAX_WORKSPACES)
  if (error) return serverError(error)

  const rows = (data ?? []) as Array<{ id: string; name: string | null; owner_id: string | null }>
  let notified = 0
  let withIssues = 0

  for (const ws of rows) {
    let issues: Issue[] = []
    try {
      issues = await collectWorkspaceIssues(admin, ws.id)
    } catch (err) {
      log.captureException(err, { workspaceId: ws.id })
      continue
    }
    if (issues.length === 0) continue
    withIssues++

    const email = await ownerEmail(ws.owner_id)
    if (!email) continue
    if (await sendAlert(email, ws.name ?? 'tu cuenta', issues)) notified++
  }

  return NextResponse.json({ workspaces: rows.length, withIssues, notified })
}

async function ownerEmail(ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null
  const admin = supabaseAdmin()
  const { data } = await admin.auth.admin.getUserById(ownerId)
  return data?.user?.email ?? null
}

/** Un correo corto: qué pasó y el link a resolverlo. Sin fallar la corrida. */
async function sendAlert(to: string, workspace: string, issues: Issue[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co'

  const lines = issues
    .map((i) => `<li style="margin:6px 0">${describe(i)} — <a href="${base}${i.href}">revisar</a></li>`)
    .join('')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.WAITLIST_FROM || 'Riverz <onboarding@resend.dev>',
        to: [to],
        subject: `Riverz · ${issues.length} cosa(s) necesitan tu atención en ${workspace}`,
        html:
          `<div style="font-family:system-ui;max-width:520px">` +
          `<h2 style="margin:0 0 8px">Necesita tu atención</h2>` +
          `<ul style="padding-left:18px">${lines}</ul>` +
          `<p style="color:#666;font-size:13px">Esto se revisa una vez por día. Si ya lo resolviste, mañana no vuelve.</p>` +
          `</div>`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Texto del correo. Español fijo: es un aviso operativo del dueño, no UI. */
function describe(issue: Issue): string {
  const detail = issue.detail ? ` (${issue.detail})` : ''
  switch (issue.kind) {
    case 'automation_stuck':
      return `${issue.count} envío(s) de una automatización quedaron a medias${detail}`
    case 'sends_failing':
      return `${issue.count} mensajes no se pudieron entregar${detail}`
    case 'whatsapp_blocked':
      return 'WhatsApp está bloqueado para enviar: revisa medio de pago y datos fiscales en Meta'
    case 'connection_error':
      return `${issue.count} conexión(es) dejaron de funcionar${detail}`
    case 'template_rejected':
      return `${issue.count} plantilla(s) rechazadas por Meta${detail}`
    case 'broadcast_stalled':
      return `${issue.count} campaña(s) quedaron enviando sin terminar${detail}`
    default:
      return 'Algo necesita tu atención'
  }
}

export const GET = withCronRun('issues-alert', cronHandler)
