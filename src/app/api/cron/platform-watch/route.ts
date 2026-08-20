import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { collectPlatformIssues, type Issue } from '@/lib/health/issues'
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule'
import { sendPlatformAlert } from '@/lib/admin/platform-whatsapp'
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
    case 'nadie_atiende':
      // El aviso mas caro de la lista: entran mensajes y no contesta nadie.
      return `${count} canal(es) recibiendo mensajes SIN ningun agente atendiendo`
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

  const [porWorkspace, salud] = await Promise.all([
    collectPlatformIssues(admin),
    admin.rpc('admin_cron_health'),
  ])
  const runs = salud.data as
    | Array<{ name: string; status: string; started_at: string | null }>
    | null

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
  //
  // "No pude leer el estado" NO es "están todos muertos". Cuando la consulta de
  // salud fallaba o volvía vacía, este bloque marcaba los 41 trabajos como
  // caídos, mandaba el correo "algo nuevo se rompió" con la lista entera, y al
  // tick siguiente —con la lectura ya sana— la huella se vaciaba. Cada ida y
  // vuelta era otro correo, y a la tercera vez nadie los lee: el aviso que
  // importa se pierde entre las falsas alarmas. Sin datos no se opina.
  const cronsRotos: string[] = []
  const saludLegible = !salud.error && (runs?.length ?? 0) > 0
  if (!saludLegible) {
    log.warn('estado de los trabajos ilegible: no se evalúan crons este tick', {
      error: salud.error?.message ?? null,
      filas: runs?.length ?? 0,
    })
  } else {
    const ultima = new Map<string, { status?: string; started_at?: string | null }>()
    for (const r of runs ?? []) ultima.set(r.name, r)
    for (const job of SCHEDULED_JOBS) {
      const run = ultima.get(job.name)
      if (run?.status === 'error' || isStale(job.schedule, run?.started_at ?? null)) {
        cronsRotos.push(job.name)
      }
    }
    // Si "se cayó" más de la mitad del catálogo de golpe, lo que se cayó es la
    // lectura, no los trabajos: 41 fallas independientes en el mismo minuto no
    // existen. Se registra y no se avisa.
    if (cronsRotos.length > SCHEDULED_JOBS.length / 2) {
      log.warn('demasiados trabajos en rojo a la vez: se ignora por sospechoso', {
        rotos: cronsRotos.length,
        total: SCHEDULED_JOBS.length,
      })
      cronsRotos.length = 0
    }
    for (const name of cronsRotos) {
      actuales.set(`cron:${name}`, {
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

  const telefono = process.env.PLATFORM_ALERT_PHONE
  const correo = process.env.PLATFORM_ALERT_EMAIL
  if (!telefono && !correo) {
    log.warn('hay novedades y no hay a quién avisarle', {
      nuevos: nuevas.length,
      falta: 'PLATFORM_ALERT_PHONE o PLATFORM_ALERT_EMAIL',
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

  const titulo = 'Riverz · algo nuevo se rompió'
  const cuerpo = lineas.join('\n')
  const via: string[] = []

  // Por el helper compartido y no por `sendTextMessage` a secas: Meta sólo
  // entrega texto libre dentro de las 24 h posteriores a que alguien nos
  // escriba. Escrito con texto libre, este aviso andaba el día de la prueba y
  // dejaba de salir en silencio al día siguiente — el peor modo de falla para
  // algo cuya única función es avisar.
  if (telefono) {
    const enviado = await sendPlatformAlert({ to: telefono, title: titulo, body: cuerpo })
    if (enviado.ok) via.push('whatsapp')
    else log.warn('no se pudo avisar por whatsapp', { error: enviado.error })
  }

  // El correo NO es un plan B de segunda: es el que funciona sin tener un
  // número de WhatsApp dado de alta, sin plantilla aprobada y sin ventana de
  // 24 h. Los dos salen si los dos están configurados — un aviso duplicado
  // molesta; uno que no sale, no se nota.
  if (correo && (await avisarPorCorreo(correo, titulo, cuerpo))) via.push('correo');

  if (via.length === 0) {
    log.warn('había novedades y ningún aviso salió', { nuevos: nuevas.length })
  }

  return NextResponse.json({
    problemas: actuales.size,
    nuevos: nuevas.length,
    cronsRotos: cronsRotos.length,
    avisado: via.length > 0,
    via,
  })
}

/** El mismo aviso, por Resend. Sin fallar la corrida si el correo no sale. */
async function avisarPorCorreo(to: string, titulo: string, cuerpo: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.WAITLIST_FROM || 'Riverz <onboarding@resend.dev>',
        to: [to],
        subject: titulo,
        html:
          `<div style="font-family:system-ui;max-width:520px">` +
          `<h2 style="margin:0 0 8px">${titulo}</h2>` +
          `<pre style="white-space:pre-wrap;font-family:system-ui;font-size:14px">${cuerpo}</pre>` +
          `<p style="color:#666;font-size:13px">Sólo se avisa lo que apareció desde el último aviso.</p>` +
          `</div>`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export const GET = withCronRun('platform-watch', cronHandler)
