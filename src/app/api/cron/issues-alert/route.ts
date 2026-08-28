import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { collectWorkspaceIssues, type Issue } from '@/lib/health/issues'
import { issueDetailText } from '@/lib/health/detail'
import { translate } from '@/lib/i18n/translate'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.issues-alert')

/**
 * El aviso que va a buscar al comercio.
 *
 * La tarjeta de Inicio sólo sirve si alguien entra a mirar, y los problemas que
 * importan son justo los que nadie mira. Una vez por día, si hay algo que SÓLO
 * el comercio puede destrabar, sale un correo al dueño del workspace.
 *
 * Una vez por día y sin ledger a propósito: la frecuencia ES la deduplicación.
 * Si el problema sigue mañana, el correo vuelve — que es lo correcto, porque
 * sigue roto. Y no hace falta ninguna tabla nueva que mantener al día.
 */
/**
 * Tamaño de página del barrido. Antes esto era un `.limit(50)` a secas y sin
 * orden: a partir del comercio 51 había cuentas que no recibían el aviso nunca,
 * en silencio y sin quedar registrado en ningún lado.
 */
const PAGE = 100

/**
 * Lo único que se le escribe al comercio.
 *
 * El resto de lo que detecta `admin_workspace_issues` —corridas fallidas,
 * mensajes que Meta rechazó, campañas trabadas, plantillas rechazadas— es
 * trabajo nuestro, no suyo. Iba en este mismo correo y llegaba con el error
 * crudo adentro: "4 mensajes no se pudieron entregar (Image is invalid. Please
 * check the image properties; supported are JPG/JPEG, RGB/RGBA, 8 bit…)". Eso
 * no le dice a nadie qué hacer, y un aviso que no se puede atender enseña a
 * ignorar todos los demás — incluidos los dos de acá abajo, que sí importan.
 *
 * El filtro es una pregunta sola: ¿puede resolverlo el comercio, y sólo él?
 * Reconectar una cuenta y arreglar el pago en Meta piden su sesión; nosotros no
 * podemos hacerlos por él. Todo lo demás vive en /admin y en el vigilante de
 * plataforma.
 */
const PARA_EL_COMERCIO: ReadonlySet<Issue['kind']> = new Set([
  'whatsapp_blocked',
  'connection_error',
])

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()
  let notified = 0
  let withIssues = 0
  let scanned = 0
  // Motivos por los que un aviso no salió. Sin esto, "0 notificados" no
  // distingue "no había nada roto" de "falta la clave de Resend".
  const skipped = { noEmail: 0, sendFailed: 0, collectFailed: 0 }

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from('workspaces')
      .select('id, name, owner_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return serverError(error)

    const rows = (data ?? []) as Array<{
      id: string
      name: string | null
      owner_id: string | null
    }>
    if (rows.length === 0) break
    scanned += rows.length

    for (const ws of rows) {
      let issues: Issue[] = []
      try {
        issues = await collectWorkspaceIssues(admin, ws.id)
      } catch (err) {
        log.captureException(err, { workspaceId: ws.id })
        skipped.collectFailed++
        continue
      }
      issues = issues.filter((i) => PARA_EL_COMERCIO.has(i.kind))
      if (issues.length === 0) continue
      withIssues++

      const email = await ownerEmail(ws.owner_id)
      if (!email) {
        skipped.noEmail++
        continue
      }
      if (await sendAlert(email, ws.name ?? 'tu cuenta', issues)) notified++
      else skipped.sendFailed++
    }

    if (rows.length < PAGE) break
  }

  if (skipped.sendFailed > 0 && !process.env.RESEND_API_KEY) {
    log.warn('no se pudo avisar: falta RESEND_API_KEY', { pendientes: skipped.sendFailed })
  }

  return NextResponse.json({ workspaces: scanned, withIssues, notified, skipped })
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
        subject: `Riverz · algo dejó de funcionar en ${workspace}`,
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

/**
 * Texto del correo. Español fijo: es un aviso operativo del dueño, no UI.
 *
 * Cada línea dice qué pasó y qué hacer, sin código de error ni jerga. Sólo
 * llegan acá las clases de `PARA_EL_COMERCIO`; el `default` existe para que
 * sumar una clase nueva al conjunto y olvidarse de este switch degrade a una
 * frase vaga en vez de romper el correo.
 */
function describe(issue: Issue): string {
  switch (issue.kind) {
    case 'whatsapp_blocked':
      return 'Tu WhatsApp no puede enviar mensajes. Meta lo bloqueó: revisa el medio de pago y los datos fiscales de la cuenta'
    case 'connection_error': {
      // El único detalle que sobrevive: son nombres de canal ("Shopify,
      // Instagram"), o sea el dato que dice cuál reconectar.
      const canales = issueDetailText(issue.kind, issue.detail, (k, v) => translate('es', k, v))
      return canales
        ? `Se desconectó ${canales}. Vuelve a conectarlo para que los mensajes sigan saliendo`
        : `${issue.count} conexión(es) dejaron de funcionar. Vuelve a conectarlas`
    }
    default:
      return 'Algo necesita tu atención'
  }
}

export const GET = withCronRun('issues-alert', cronHandler)
