import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { collectPlatformIssues, type Issue } from '@/lib/health/issues'
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule'
import { isActionableCronFailure } from '@/lib/cron/recovery'
import {
  platformTechnicalAlertRecipients,
  sendPlatformAlert,
} from '@/lib/admin/platform-whatsapp'
import { leerProveedores } from '@/lib/admin/proveedores'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.platform-watch')

/**
 * El aviso que va a buscar al dueño de la plataforma.
 *
 * El panel ya muestra lo que está roto, pero sólo sirve si alguien lo tiene
 * abierto — y lo que importa es enterarse justo cuando NO se está mirando. Esto
 * cierra el círculo: cada 15 minutos mira el estado de los trabajos de fondo y
 * los problemas de todos los comercios, y si apareció algo NUEVO **de la
 * plataforma** manda un WhatsApp por el número de Riverz.
 *
 * Qué es "de la plataforma" y qué no: un proveedor sin saldo, un trabajo de
 * fondo detenido, o un mismo problema en varios comercios a la vez. Un comercio con un envío fallado NO lo
 * es —por más que el mensaje se pueda armar igual— y avisarlo cada 15 minutos
 * era lo que ahogaba a los avisos que sí importan: llegaban "Pilar: 4 mensajes
 * sin entregar (Image is invalid…)" mezclados con "Trabajo detenido:
 * tiktok-webhook", y a la tercera vez se dejan de leer los dos. Lo de un solo
 * comercio vive en /admin, que es donde se mira a propósito.
 *
 * Y no baja al comercio: `issues-alert` decide aparte qué de eso le sirve al
 * dueño de la cuenta. Lo técnico no cruza esa línea en ninguna dirección.
 *
 * La huella es el conjunto de problemas. Si no cambió, no se avisa. Si aparecen
 * claves nuevas, el mensaje trae SÓLO esas: repetir lo que ya se dijo es la
 * forma más rápida de que se ignore.
 */

/** Cuántas líneas entran en el mensaje antes de resumir. */
const MAX_LINEAS = 8

/**
 * A partir de cuántos comercios un mismo problema deja de ser de un comercio y
 * pasa a ser de la plataforma. Tres cuentas distintas fallando por lo mismo el
 * mismo día no es casualidad: es un token vencido, un permiso caído o un
 * despliegue. Con menos de tres, la explicación más probable es la cuenta.
 */
const UMBRAL_MASIVO = 3

type Clave = string

/** Cuántos comercios distintos sufren cada clase de problema. */
function porClase(porWorkspace: Map<string, Issue[]>): Map<Issue['kind'], number> {
  const out = new Map<Issue['kind'], number>()
  for (const issues of porWorkspace.values()) {
    for (const kind of new Set(issues.map((i) => i.kind))) {
      out.set(kind, (out.get(kind) ?? 0) + 1)
    }
  }
  return out
}

/**
 * Cómo se llama cada clase de problema cuando es masivo. Sin el detalle crudo:
 * el motivo de un comercio no explica a los otros dos, y pegarlo en el mensaje
 * hace creer que sí.
 */
function nombreProblema(kind: Issue['kind']): string {
  switch (kind) {
    case 'automation_stuck':
      return 'automatizaciones trabadas'
    case 'automation_failed':
      return 'automatizaciones que fallan'
    case 'sends_failing':
      return 'mensajes sin entregar'
    case 'voice_send_failed':
      return 'WhatsApp prometidos en una llamada que no llegaron'
    case 'whatsapp_blocked':
      return 'WhatsApp bloqueado para enviar'
    case 'connection_error':
      return 'conexiones caídas'
    case 'template_rejected':
      return 'plantillas rechazadas'
    case 'broadcast_stalled':
      return 'campañas trabadas'
    case 'channel_silent':
      return 'canales que dejaron de recibir'
    case 'ai_down':
      return 'asistentes que dejaron de contestar'
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

  // Clave estable -> la línea tal cual va en el mensaje.
  const actuales = new Map<Clave, string>()

  // Lo mismo roto en varios comercios a la vez: eso sí es de la plataforma.
  let masivos = 0
  for (const [kind, comercios] of porClase(porWorkspace)) {
    if (comercios < UMBRAL_MASIVO) continue
    masivos++
    actuales.set(`masivo:${kind}`, `· ${comercios} comercios con ${nombreProblema(kind)}`)
  }

  // Un canal silencioso no espera a afectar a tres comercios para escalarse:
  // puede ser el primer síntoma de un webhook caído, una renovación fallida o
  // una regresión del proveedor. El comercio recibe su propio aviso, pero el
  // equipo tiene que enterarse al mismo tiempo para confirmar la causa y no
  // dejar que otros canales caigan por el mismo motivo.
  for (const [workspaceId, issues] of porWorkspace) {
    for (const issue of issues) {
      if (issue.kind !== 'channel_silent' && issue.kind !== 'connection_error') continue
      const channel = issue.refId ?? 'canal'
      const key = `canal:${workspaceId}:${issue.kind}:${channel}`
      const label =
        issue.kind === 'channel_silent'
          ? `· Canal sin actividad: ${channel}`
          : `· Conexión con error: ${issue.detail ?? channel}`
      actuales.set(key, label)
    }
  }

  // Los trabajos de fondo entran a la misma lista: un cron muerto no le pertenece
  // a ningún comercio, pero es lo que hace que dejen de salir los mensajes.
  //
  // "No pude leer el estado" NO es "están todos muertos". Cuando la consulta de
  // salud fallaba o volvía vacía, este bloque marcaba los 41 trabajos como
  // caídos, mandaba el correo "algo nuevo se rompió" con la lista entera, y al
  // tick siguiente —con la lectura ya sana— la huella se vaciaba. Cada ida y
  // vuelta era otro correo, y a la tercera vez nadie los lee: el aviso que
  // importa se pierde entre las falsas alarmas. Sin datos no se opina.
  // Dos cosas distintas que el aviso mezclaba en una sola frase: el trabajo que
  // DEJÓ DE CORRER y el que corre puntual pero termina en error. Decirle
  // "detenido" al segundo manda a buscar un reloj parado que está andando bien,
  // y hace desconfiar del resto de los avisos.
  const cronsRotos: Array<{ name: string; motivo: 'detenido' | 'error' }> = []
  const saludLegible = !salud.error && (runs?.length ?? 0) > 0
  if (!saludLegible) {
    log.warn('estado de los trabajos ilegible: no se evalúan crons este tick', {
      error: salud.error?.message ?? null,
      filas: runs?.length ?? 0,
    })
  } else {
    const ultima = new Map<string, { status?: string; started_at?: string | null }>()
    for (const r of runs ?? []) ultima.set(r.name, r)
    const erroresPorConfirmar: string[] = []
    for (const job of SCHEDULED_JOBS) {
      const run = ultima.get(job.name)
      const detenido = isStale(job.schedule, run?.started_at ?? null)
      if (detenido) cronsRotos.push({ name: job.name, motivo: 'detenido' })
      else if (run?.status === 'error') erroresPorConfirmar.push(job.name)
    }

    // Un error reciente tiene primero una oportunidad de autorrepararse. Sólo
    // se avisa si el reintento también falló o si quedó sin resolver pasado el
    // margen. Las consultas se hacen únicamente para los pocos que están en
    // rojo, no una por cada trabajo sano del catálogo.
    const confirmados = await Promise.all(
      erroresPorConfirmar.map(async (name) => {
        const { data, error } = await admin
          .from('cron_runs')
          .select('status, started_at')
          .eq('name', name)
          .in('status', ['ok', 'error'])
          .order('started_at', { ascending: false })
          .limit(2)
        if (error) {
          log.warn('no se pudo confirmar un trabajo en error', { job: name, error: error.message })
          return false
        }
        return isActionableCronFailure(data ?? [])
      }),
    )
    for (let i = 0; i < erroresPorConfirmar.length; i++) {
      if (confirmados[i]) cronsRotos.push({ name: erroresPorConfirmar[i], motivo: 'error' })
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
    for (const { name, motivo } of cronsRotos) {
      actuales.set(
        `cron:${name}`,
        motivo === 'detenido' ? `· Trabajo detenido: ${name}` : `· Trabajo con errores: ${name}`,
      )
    }
  }

  // El saldo de los proveedores. Es el aviso que más falta hacía: cuando
  // Anthropic o Telnyx llegan a cero, la plataforma no devuelve un error —
  // devuelve silencio, y se descubre por un comercio que reclama. Entra a la
  // misma lista para que herede lo que ya funciona: una sola vez por problema,
  // y nada de repetir lo que ya se dijo.
  //
  // Fail-soft: si un proveedor no contesta, ese proveedor no opina. Un timeout
  // no puede convertirse en "quedate tranquilo" ni en una alarma falsa.
  try {
    const { proveedores } = await leerProveedores()
    for (const p of proveedores) {
      // Sólo los que se recargan: que Supabase no publique saldo no es una
      // alarma, es que no tiene saldo que publicar.
      if (!p.recargable) continue
      if (p.estado !== 'sin_saldo' && p.estado !== 'bajo') continue
      const cuanto =
        p.saldo === null
          ? ''
          : ` (quedan ${p.saldo.toFixed(2)} ${p.unidad ?? ''})`.replace(/ +\)/, ')')
      actuales.set(
        `saldo:${p.id}`,
        p.estado === 'sin_saldo'
          ? `· ${p.nombre} SIN SALDO — recargar ya: ${p.url}`
          : `· ${p.nombre} con poco saldo${cuanto} — recargar: ${p.url}`,
      )
    }
  } catch (err) {
    log.warn('no se pudo leer el saldo de los proveedores', {
      error: err instanceof Error ? err.message : String(err),
    })
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

  // El emisor es el WhatsApp de Riverz; los destinatarios son exclusivamente
  // de administración y viven con esa configuración. Render queda como
  // respaldo hasta que se aplique la migración que habilita el panel.
  const { phone: telefono, email: correo } = await platformTechnicalAlertRecipients()
  if (!telefono && !correo) {
    log.warn('hay novedades y no hay a quién avisarle', {
      nuevos: nuevas.length,
      falta: 'PLATFORM_ALERT_PHONE o PLATFORM_ALERT_EMAIL',
    })
    return NextResponse.json({ problemas: actuales.size, nuevos: nuevas.length, avisado: false })
  }

  const lineas = nuevas.slice(0, MAX_LINEAS).map((k) => actuales.get(k)!)
  if (nuevas.length > MAX_LINEAS) {
    lineas.push(`· y ${nuevas.length - MAX_LINEAS} más`)
  }

  // Dos títulos y no uno: la plantilla de WhatsApp ya empieza con "Riverz ·",
  // así que mandarle el prefijo llegaba como "Riverz · Riverz · algo nuevo se
  // rompió". El correo no tiene ese encabezado y sí lo necesita en el asunto.
  const tituloWhatsapp = 'algo nuevo se rompió'
  const tituloCorreo = 'Riverz · algo nuevo se rompió'
  const cuerpo = lineas.join('\n')
  const via: string[] = []

  // Por el helper compartido y no por `sendTextMessage` a secas: Meta sólo
  // entrega texto libre dentro de las 24 h posteriores a que alguien nos
  // escriba. Escrito con texto libre, este aviso andaba el día de la prueba y
  // dejaba de salir en silencio al día siguiente — el peor modo de falla para
  // algo cuya única función es avisar.
  if (telefono) {
    const enviado = await sendPlatformAlert({ to: telefono, title: tituloWhatsapp, body: cuerpo })
    if (enviado.ok) via.push('whatsapp')
    else log.warn('no se pudo avisar por whatsapp', { error: enviado.error })
  }

  // El correo NO es un plan B de segunda: es el que funciona sin tener un
  // número de WhatsApp dado de alta, sin plantilla aprobada y sin ventana de
  // 24 h. Los dos salen si los dos están configurados — un aviso duplicado
  // molesta; uno que no sale, no se nota.
  if (correo && (await avisarPorCorreo(correo, tituloCorreo, cuerpo))) via.push('correo');

  if (via.length === 0) {
    log.warn('había novedades y ningún aviso salió', { nuevos: nuevas.length })
  }

  return NextResponse.json({
    problemas: actuales.size,
    nuevos: nuevas.length,
    cronsRotos: cronsRotos.length,
    masivos,
    comerciosConProblemas: porWorkspace.size,
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
