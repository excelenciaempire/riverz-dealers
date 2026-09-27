import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { collectPlatformIssues, type Issue } from '@/lib/health/issues'
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule'
import {
  isActionableCronFailure,
  needsCronFailureConfirmation,
} from '@/lib/cron/recovery'
import { platformTechnicalAlertRecipients, sendPlatformAlert } from '@/lib/admin/platform-whatsapp'
import { leerProveedores } from '@/lib/admin/proveedores'
import { getLogger } from '@/lib/log/logger'
import {alertCandidates, rememberAlerts, type AlertHistory} from '@/lib/health/alert-history'

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

/** Prefijo en la huella de un problema visto una vez y todavía no avisado. */
const PENDIENTE = '~'

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
    case 'tracking_missing':
      return 'pedidos sin guía en Shopify'
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

  // An unreadable snapshot is not an empty incident list.
  const { data: estadoRow, error: estadoError } = await admin
    .from('platform_watch_state')
    .select('fingerprint, alert_history, updated_at')
    .eq('id', true)
    .maybeSingle()
  if (estadoError) throw new Error(`platform_watch_state: ${estadoError.message}`)
  const anterior = estadoRow?.fingerprint ?? ''
  const previas = new Set<string>(anterior ? anterior.split('|') : [])
  const history = (estadoRow?.alert_history ?? {}) as AlertHistory
  const conservar = new Set<string>()
  const lecturasFallidas: string[] = []
  const conservarPrefijo = (prefix: string) => {
    for (const key of previas) if (key.startsWith(prefix)) conservar.add(key)
  }

  const [porWorkspace, salud, dropi] = await Promise.all([
    collectPlatformIssues(admin).catch((err) => {
      log.warn('no se pudo leer la salud de comercios', { error: String(err) })
      lecturasFallidas.push('workspace_health')
      conservarPrefijo('canal:')
      conservarPrefijo(`${PENDIENTE}canal:`)
      conservarPrefijo('masivo:')
      return new Map<string, Issue[]>()
    }),
    admin.rpc('admin_cron_health'),
    admin
      .from('dropi_connections')
      .select('workspace_id, config')
      .eq('status', 'connected')
      .not('config->>last_error', 'is', null),
  ])
  const runs = salud.data as Array<{
    name: string
    status: string
    started_at: string | null
  }> | null

  // Clave estable -> la línea tal cual va en el mensaje.
  const actuales = new Map<Clave, string>()

  // Lo mismo roto en varios comercios a la vez: eso sí es de la plataforma.
  let masivos = 0
  for (const [kind, comercios] of porClase(porWorkspace)) {
    // Missing labels are a fulfillment task, not proof of a platform outage.
    // Keep them in the merchant/admin logistics views; never invent shipment data.
    if (kind === 'tracking_missing') continue
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
      // SQL aggregates broken connections by workspace, ordered by updated_at.
      // The first label changes on every refresh: it is not an incident ID.
      const channels = issue.kind === 'connection_error'
        ? [...new Set((issue.detail || issue.refId || 'canal').split(',').map(value => value.trim()).filter(Boolean))]
        : [issue.refId || 'canal']
      for (const channel of channels) {
        const key = `canal:${workspaceId}:${issue.kind}:${channel}`
        const label = issue.kind === 'channel_silent'
          ? `· Canal sin actividad: ${channel}`
          : `· Conexión con error: ${channel}`
        actuales.set(key, label)
      }
    }
  }

  // Dropi es salida, no sincronización: crea un despacho. Ante una respuesta
  // incierta no se reintenta a ciegas porque podría duplicar el pedido. La
  // falla queda en la conexión y sólo llega acá si ningún envío posterior la
  // limpió antes del siguiente tick.
  if (dropi.error) {
    lecturasFallidas.push('dropi_health')
    conservarPrefijo('integracion:')
    log.warn('no se pudo leer la salud de Dropi', {
      error: dropi.error.message,
    })
  } else {
    for (const row of (dropi.data ?? []) as Array<{
      workspace_id: string
      config?: { last_error?: string | null } | null
    }>) {
      if (!row.config?.last_error) continue
      actuales.set(`integracion:${row.workspace_id}:dropi`, '· Integración con error: Dropi')
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
    lecturasFallidas.push('cron_health')
    conservarPrefijo('cron:')
    log.warn('estado de los trabajos ilegible: no se evalúan crons este tick', {
      error: salud.error?.message ?? null,
      filas: runs?.length ?? 0,
    })
  } else {
    const ultima = new Map<string, { status?: string; started_at?: string | null }>()
    for (const r of runs ?? []) ultima.set(r.name, r)
    const pendientesPorConfirmar: string[] = []
    for (const job of SCHEDULED_JOBS) {
      const run = ultima.get(job.name)
      const detenido = isStale(job.schedule, run?.started_at ?? null)
      if (detenido) cronsRotos.push({ name: job.name, motivo: 'detenido' })
      // Un `running` no demuestra recuperación: el monitor y el trabajo pueden
      // arrancar en el mismo segundo. Se consulta el último resultado completo
      // para no borrar la huella del incidente mientras corre su siguiente
      // intento y volver a notificarla quince minutos después.
      else if (needsCronFailureConfirmation(run?.status)) pendientesPorConfirmar.push(job.name)
    }

    // Un error reciente tiene primero una oportunidad de autorrepararse. Sólo
    // se avisa si el reintento también falló o si quedó sin resolver pasado el
    // margen. Las consultas se hacen únicamente para los pocos que están en
    // rojo, no una por cada trabajo sano del catálogo.
    const confirmados = await Promise.all(
      pendientesPorConfirmar.map(async (name) => {
        const { data, error } = await admin
          .from('cron_runs')
          .select('status, started_at')
          .eq('name', name)
          .in('status', ['ok', 'error'])
          .order('started_at', { ascending: false })
          // El scheduler deja dos filas cuando hace un retry rápido. Leer más
          // permite distinguir ese par de dos ciclos programados realmente
          // fallidos sin perder el último resultado sano que corta la racha.
          .limit(6)
        if (error) {
          lecturasFallidas.push(`cron_confirmation:${name}`)
          if (previas.has(`cron:${name}`)) conservar.add(`cron:${name}`)
          log.warn('no se pudo confirmar un trabajo en error', {
            job: name,
            error: error.message,
          })
          return false
        }
        // Only a completed success closes an already announced incident.
        if (data?.[0]?.status === 'error' && previas.has(`cron:${name}`)) {
          conservar.add(`cron:${name}`)
        }
        if (!data?.length && previas.has(`cron:${name}`)) conservar.add(`cron:${name}`)
        return isActionableCronFailure(data ?? [])
      })
    )
    for (let i = 0; i < pendientesPorConfirmar.length; i++) {
      if (confirmados[i]) cronsRotos.push({ name: pendientesPorConfirmar[i], motivo: 'error' })
    }
    // Si "se cayó" más de la mitad del catálogo de golpe, lo que se cayó es la
    // lectura, no los trabajos: 41 fallas independientes en el mismo minuto no
    // existen. Se registra y no se avisa.
    if (cronsRotos.length > SCHEDULED_JOBS.length / 2) {
      lecturasFallidas.push('cron_health_suspicious')
      conservarPrefijo('cron:')
      log.warn('demasiados trabajos en rojo a la vez: se ignora por sospechoso', {
        rotos: cronsRotos.length,
        total: SCHEDULED_JOBS.length,
      })
      cronsRotos.length = 0
    }
    for (const { name, motivo } of cronsRotos) {
      actuales.set(
        `cron:${name}`,
        motivo === 'detenido' ? `· Trabajo detenido: ${name}` : `· Trabajo con errores: ${name}`
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
    const checkedAt = new Date().toISOString()
    // Persist only the sanitized operational snapshot. Merchant APIs consume
    // an aggregate readiness result; provider names, keys and raw errors never
    // leave the service-role boundary.
    const { error: snapshotError } = await admin
      .from('platform_provider_health')
      .upsert(
        proveedores.map((p) => ({
          provider: p.id,
          category: p.categoria,
          state: p.estado,
          balance: p.saldo,
          unit: p.unidad,
          checked_at: checkedAt,
        })),
        { onConflict: 'provider' }
      )
    if (snapshotError) {
      log.warn('no se pudo guardar la salud de proveedores', {
        error: snapshotError.message,
      })
    }
    for (const p of proveedores) {
      if (p.estado === 'error') conservarPrefijo(`saldo:${p.id}`)
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
          : `· ${p.nombre} con poco saldo${cuanto} — recargar: ${p.url}`
      )
    }
  } catch (err) {
    lecturasFallidas.push('provider_health')
    conservarPrefijo('saldo:')
    log.warn('no se pudo leer el saldo de los proveedores', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Una conexión en error se avisa recién si sigue en error en el tick
  // siguiente. Un tropiezo de la Graph API deja `ig_comment` en error hasta la
  // próxima sincronización, que lo limpia; avisarlo al instante mandaba
  // "Conexión con error: ig_comment" varias veces por día por algo que se
  // arreglaba solo. La primera vez queda anotada como pendiente en la huella.
  const pendientes = new Set(
    [...actuales.keys()].filter(
      (k) => k.startsWith('canal:') && !previas.has(k) && !previas.has(PENDIENTE + k),
    ),
  )
  const fingerprint = [...new Set([
    ...[...actuales.keys()].map((k) => (pendientes.has(k) ? PENDIENTE + k : k)),
    ...conservar,
  ])].sort().join('|')
  const respond = (body: Record<string, unknown>) => NextResponse.json({
    ...body,
    ...(lecturasFallidas.length ? { error: lecturasFallidas.join(', ') } : {}),
  }, { status: lecturasFallidas.length ? 207 : 200 })

  if (fingerprint === anterior) {
    return respond({
      problemas: actuales.size,
      nuevos: 0,
      avisado: false,
    })
  }

  const nuevas = alertCandidates([...actuales.keys()].filter((k) => !previas.has(k) && !pendientes.has(k)), history)

  // Guardar SIEMPRE, aunque el aviso no salga: si no, un fallo de WhatsApp
  // convierte el próximo tick en el mismo mensaje otra vez, cada 15 minutos.
  const snapshot = {
      id: true,
      fingerprint,
      alert_history: rememberAlerts(history, nuevas),
      notified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  // Compare-and-set prevents two overlapping monitors announcing the same change.
  const saved = estadoRow
    ? await admin.from('platform_watch_state').update(snapshot)
      .eq('id', true).eq('fingerprint', anterior).select('id')
    : await admin.from('platform_watch_state').insert(snapshot).select('id')
  if (saved.error) throw new Error(`platform_watch_state: ${saved.error.message}`)
  if (!saved.data?.length) return respond({ avisado: false, concurrent: true })

  // Que desaparezca un problema también cambia la huella, y eso no se avisa.
  if (nuevas.length === 0) {
    return respond({
      problemas: actuales.size,
      nuevos: 0,
      avisado: false,
    })
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
    return respond({
      problemas: actuales.size,
      nuevos: nuevas.length,
      avisado: false,
    })
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
    const enviado = await sendPlatformAlert({
      to: telefono,
      title: tituloWhatsapp,
      body: cuerpo,
    })
    if (enviado.ok) via.push('whatsapp')
    else log.warn('no se pudo avisar por whatsapp', { error: enviado.error })
  }

  // El correo NO es un plan B de segunda: es el que funciona sin tener un
  // número de WhatsApp dado de alta, sin plantilla aprobada y sin ventana de
  // 24 h. Los dos salen si los dos están configurados — un aviso duplicado
  // molesta; uno que no sale, no se nota.
  if (correo && (await avisarPorCorreo(correo, tituloCorreo, cuerpo))) via.push('correo')

  if (via.length === 0) {
    log.warn('había novedades y ningún aviso salió', { nuevos: nuevas.length })
  }

  return respond({
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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
