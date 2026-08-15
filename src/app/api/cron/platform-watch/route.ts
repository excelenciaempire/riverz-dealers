import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { collectPlatformIssues, type Issue } from '@/lib/health/issues'
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule'
import { platformWhatsApp } from '@/lib/admin/platform-whatsapp'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.platform-watch')

/**
 * El aviso que va a buscar al dueño de la plataforma.
 *
 * El panel ya muestra lo que está roto, pero sólo sirve si alguien lo tiene
 * abierto — y lo que importa es enterarse justo cuando NO se está mirando. Esto
 * cierra el círculo: cada 15 minutos cruza los problemas de todos los comercios
 * con el estado de los trabajos de fondo, y si apareció algo NUEVO manda un
 * WhatsApp por el número de la plataforma.
 *
 * Es el hermano de `issues-alert`, que avisa al comercio una vez por día. Este
 * avisa al equipo enseguida, y por eso necesita deduplicar: sin memoria sería o
 * el mismo mensaje cada 15 minutos —que a la tercera vez se deja de leer, y con
 * él todos los demás— o un resumen diario que llega tarde.
 *
 * La huella es el conjunto de problemas. Si no cambió, no se avisa. Si aparecen
 * claves nuevas, el mensaje trae SÓLO esas: repetir lo que ya se dijo es la
 * forma más rápida de que se ignore.
 */

/** Cuántas líneas entran en el mensaje antes de resumir. */
const MAX_LINEAS = 8

type Clave = string

function claves(porWorkspace: Map<string, Issue[]>): Map<Clave, { ws: string; issue: Issue }> {
  const out = new Map<Clave, { ws: string; issue: Issue }>()
  for (const [ws, issues] of porWorkspace) {
    for (const issue of issues) out.set(`${ws}:${issue.kind}`, { ws, issue })
  }
  return out
}

/** Qué dice cada problema, en una línea. Español fijo: es un aviso interno. */
function describe(kind: Issue['kind'], count: number, detail?: string | null): string {
  const extra = detail ? ` (${detail})` : ''
  switch (kind) {
    case 'automation_stuck':
      return `${count} corrida(s) de automatización trabadas${extra}`
    case 'automation_failed':
      return `${count} corrida(s) de automatización fallaron${extra}`
    case 'sends_failing':
      return `${count} mensajes sin entregar${extra}`
    case 'whatsapp_blocked':
      return 'WhatsApp bloqueado para enviar'
    case 'connection_error':
      return `${count} conexión(es) caídas${extra}`
    case 'template_rejected':
      return `${count} plantilla(s) rechazadas${extra}`
    case 'broadcast_stalled':
      return `${count} campaña(s) trabadas${extra}`
  }
}

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()

  const [porWorkspace, { data: runs }] = await Promise.all([
    collectPlatformIssues(admin),
    admin.rpc('admin_cron_health'),
  ])

  // Nombres de comercio para que el mensaje diga algo más que un uuid.
  const nombres = new Map<string, string>()
  if (porWorkspace.size > 0) {
    const { data } = await admin
      .from('workspaces')
      .select('id, name')
      .in('id', [...porWorkspace.keys()])
    for (const w of (data ?? []) as { id: string; name: string }[]) {
      nombres.set(w.id, w.name)
    }
  }

  const actuales = claves(porWorkspace)

  // Los trabajos de fondo entran a la misma lista: un cron muerto no le pertenece
  // a ningún comercio, pero es lo que hace que dejen de salir los mensajes.
  const ultima = new Map<string, { status?: string; started_at?: string | null }>()
  for (const r of (runs ?? []) as { name: string; status: string; started_at: string | null }[]) {
    ultima.set(r.name, r)
  }
  const cronsRotos: string[] = []
  for (const job of SCHEDULED_JOBS) {
    const run = ultima.get(job.name)
    if (run?.status === 'error' || isStale(job.schedule, run?.started_at ?? null)) {
      cronsRotos.push(job.name)
      actuales.set(`cron:${job.name}`, {
        ws: '',
        issue: { kind: 'automation_failed', severity: 'critical', count: 1, href: '' },
      })
    }
  }

  const fingerprint = [...actuales.keys()].sort().join('|')

  const { data: estadoRow } = await admin
    .from('platform_watch_state')
    .select('fingerprint')
    .eq('id', true)
    .maybeSingle()
  const anterior = (estadoRow as { fingerprint?: string | null } | null)?.fingerprint ?? ''

  if (fingerprint === anterior) {
    return NextResponse.json({ problemas: actuales.size, nuevos: 0, avisado: false })
  }

  const previas = new Set(anterior ? anterior.split('|') : [])
  const nuevas = [...actuales.keys()].filter((k) => !previas.has(k))

  // Guardar SIEMPRE, aunque el aviso no salga: si no, un fallo de WhatsApp
  // convierte el próximo tick en el mismo mensaje otra vez, cada 15 minutos.
  await admin
    .from('platform_watch_state')
    .upsert(
      { id: true, fingerprint, notified_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )

  // Que desaparezca un problema también cambia la huella, y eso no se avisa.
  if (nuevas.length === 0) {
    return NextResponse.json({ problemas: actuales.size, nuevos: 0, avisado: false })
  }

  const destino = process.env.PLATFORM_ALERT_PHONE
  const plataforma = await platformWhatsApp()
  if (!destino || !plataforma) {
    log.warn('hay novedades y no hay a quién avisarle', {
      nuevos: nuevas.length,
      falta: !destino ? 'PLATFORM_ALERT_PHONE' : 'whatsapp de plataforma',
    })
    return NextResponse.json({ problemas: actuales.size, nuevos: nuevas.length, avisado: false })
  }

  const lineas = nuevas.slice(0, MAX_LINEAS).map((k) => {
    if (k.startsWith('cron:')) return `· Trabajo detenido: ${k.slice(5)}`
    const entry = actuales.get(k)!
    const nombre = nombres.get(entry.ws) ?? entry.ws.slice(0, 8)
    return `· ${nombre}: ${describe(entry.issue.kind, entry.issue.count, entry.issue.detail)}`
  })
  if (nuevas.length > MAX_LINEAS) {
    lineas.push(`· y ${nuevas.length - MAX_LINEAS} más`)
  }

  const texto = `Riverz · algo nuevo se rompió\n\n${lineas.join('\n')}`
  try {
    await sendTextMessage({
      phoneNumberId: plataforma.phoneNumberId,
      accessToken: plataforma.token,
      to: destino,
      text: texto,
    })
  } catch (err) {
    log.captureException(err)
    return NextResponse.json({ problemas: actuales.size, nuevos: nuevas.length, avisado: false })
  }

  return NextResponse.json({
    problemas: actuales.size,
    nuevos: nuevas.length,
    cronsRotos: cronsRotos.length,
    avisado: true,
  })
}

export const GET = withCronRun('platform-watch', cronHandler)
