import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from "@/lib/cron/heartbeat";
import { getLogger } from '@/lib/log/logger'
import {purgeNativeHistoryStorage} from '@/lib/migrations/archive-worker'
import {purgePortalVisits} from '@/lib/help-portal/service'

const log = getLogger('cron.pii-purge')

/**
 * GET /api/cron/pii-purge
 *
 * Borrado real de PII para workspaces soft-eliminados (migration 044 dejó
 * sólo `workspaces.deleted_at`; el "proceso operador" que iba a purgar de
 * verdad nunca existió). Para cada workspace cuyo `deleted_at` supere el
 * período de gracia (`PII_PURGE_GRACE_DAYS`, default 30) borramos de forma
 * DEFINITIVA los datos personales del tenant:
 *
 *   - `conversations` del workspace  → cascada a `messages` y `comments_meta`
 *   - `contacts` del workspace       → cascada a conversaciones restantes,
 *      `contact_tags`, `contact_custom_values`, `contact_notes`,
 *      `contact_reengagement_state`, etc.
 *   - archivos en Storage bajo el prefijo `${workspaceId}/` del bucket
 *     `message-media` (adjuntos ingestados; ver lib/channels/media-ingest.ts)
 *
 * NO borramos la fila `workspaces` en sí — la conservamos como tombstone
 * (con `deleted_at`) para auditoría. El barrido es naturalmente idempotente:
 * tras el borrado ya no quedan contactos/conversaciones, así que una segunda
 * corrida sobre el mismo workspace es un no-op (cuenta 0 en cada paso).
 *
 * Fail-soft: cada workspace y cada paso se aísla en try/catch para que un
 * fallo no aborte el resto del barrido. Auth: header `x-cron-secret` ==
 * `AUTOMATION_CRON_SECRET` (mismo secreto compartido que el resto de crons).
 *
 * Schedule sugerido (Render Cron): diario, p.ej. "30 3 * * *".
 */

const DEFAULT_GRACE_DAYS = 30
const MEDIA_BUCKET = 'message-media'
const WORKSPACE_BATCH = 50

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const graceDays = Number(process.env.PII_PURGE_GRACE_DAYS) || DEFAULT_GRACE_DAYS
  const cutoff = new Date(
    Date.now() - graceDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  const admin = supabaseAdmin()

  // Workspaces fuera del período de gracia. Limitamos el lote por corrida
  // para acotar el trabajo; el resto se procesa en las siguientes pasadas.
  const { data: rows, error } = await admin
    .from('workspaces')
    .select('id, deleted_at')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff)
    .order('deleted_at', { ascending: true })
    .limit(WORKSPACE_BATCH)
  if (error) {
    log.error('list workspaces failed', { error: error.message })
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }

  const targets = (rows ?? []) as Array<{ id: string; deleted_at: string }>
  let purged = 0
  let failed = 0
  const results: Array<Record<string, unknown>> = []

  for (const ws of targets) {
    try {
      const res = await purgeWorkspace(admin, ws.id)
      purged++
      results.push({ workspace_id: ws.id, ...res })
    } catch (err) {
      failed++
      log.error('workspace purge failed', {
        workspace_id: ws.id,
        error: err instanceof Error ? err.message : String(err),
      })
      results.push({ workspace_id: ws.id, error: true })
    }
  }

  const retencion = await purgeOperationalLogs(admin)
  // Only the new import staging/receipts. Expiry is enforced on reads even
  // if this daily sweep is delayed; never logs uploaded contact fields.
  const migrationRetention = await admin.rpc('purge_contact_migration_payloads')
  if (migrationRetention.error) {
    failed++
    log.error('contact migration retention failed')
  }
  const nativeMigrationRetention = await admin.rpc('purge_native_contact_migrations')
  if (nativeMigrationRetention.error) { failed++; log.error('native contact migration retention failed') }
  const externalMigrationRetention=await admin.rpc('purge_external_contact_migrations')
  if(externalMigrationRetention.error){failed++;log.error('external contact migration retention failed')}
  const voiceHumanRetention=await admin.rpc('purge_voice_human_handoffs')
  if(voiceHumanRetention.error){failed++;log.error('human voice control retention failed')}
  const voiceWhatsAppRetention=await admin.rpc('purge_voice_whatsapp_control')
  if(voiceWhatsAppRetention.error){failed++;log.error('WhatsApp voice control retention failed')}
  const nativeSmsRetention=await admin.rpc('purge_native_sms_control',{p_grace_days:Math.max(1,Math.min(365,Math.floor(graceDays)))})
  if(nativeSmsRetention.error){failed++;log.error('native SMS control retention failed')}
  const historyRetention=await admin.rpc('purge_native_history_archives')
  if(historyRetention.error){failed++;log.error('native history archive retention failed')}
  let archiveObjectsCleared:number|null=null
  try{archiveObjectsCleared=await purgeNativeHistoryStorage(admin)}catch{failed++;log.error('native history archive object cleanup failed')}
  let helpPortalVisitsCleared:number|null=null
  try{helpPortalVisitsCleared=await purgePortalVisits(admin)}catch{failed++;log.error('help portal visit retention failed')}

  // 207 si algún workspace falló, para que el monitor de Render lo marque.
  const status = failed > 0 ? 207 : 200
  return NextResponse.json(
    { candidates: targets.length, purged, failed, graceDays, retencion, migrationPreviewsCleared: migrationRetention.error ? null : migrationRetention.data, nativeMigrationStagingCleared: nativeMigrationRetention.error ? null : nativeMigrationRetention.data,externalMigrationStagingCleared:externalMigrationRetention.error?null:externalMigrationRetention.data,voiceHumanControlsCleared:voiceHumanRetention.error?null:voiceHumanRetention.data,voiceWhatsAppControlsCleared:voiceWhatsAppRetention.error?null:voiceWhatsAppRetention.data,nativeSmsControlsCleared:nativeSmsRetention.error?null:nativeSmsRetention.data, historyArchivesCleared:historyRetention.error?null:historyRetention.data,archiveObjectsCleared,helpPortalVisitsCleared, results },
    { status },
  )
}

/** Días que se conservan las corridas de los trabajos de fondo. */
const CRON_RUNS_DAYS = 30
/** Días que se conserva un webhook YA procesado. Es también hasta dónde llega
 *  el backfill de WhatsApp, que relee este diario (igAgent.backfillWhatsAppWindow). */
const WEBHOOK_DAYS = 14

/**
 * Retención de las dos tablas operativas que crecían para siempre.
 *
 * No había un solo DELETE sobre ninguna de las dos en todo el repo.
 * `cron_runs` suma del orden de diez mil filas por día — seis trabajos corren
 * cada minuto — y `webhook_events_raw` guarda el CUERPO CRUDO de cada webhook
 * entrante, con mensajes y teléfonos adentro. Eso último no es sólo espacio: es
 * PII de compradores acumulándose sin vencimiento en una tabla que existe para
 * poder depurar un webhook de anteayer.
 *
 * Los que todavía no se procesaron NO se borran: son justamente los que hay que
 * mirar, y son los que cuenta la alerta del panel.
 *
 * Va acá y no en un cron nuevo porque este ya es el barrendero diario.
 */
async function purgeOperationalLogs(
  admin: SupabaseClient,
): Promise<{ cronRuns: number; webhooks: number }> {
  const out = { cronRuns: 0, webhooks: 0 }

  const cronCutoff = new Date(Date.now() - CRON_RUNS_DAYS * 86_400_000).toISOString()
  out.cronRuns = await deleteOlderThan(admin, {
    table: 'cron_runs',
    column: 'started_at',
    cutoff: cronCutoff,
  })

  const hookCutoff = new Date(Date.now() - WEBHOOK_DAYS * 86_400_000).toISOString()
  out.webhooks = await deleteOlderThan(admin, {
    table: 'webhook_events_raw',
    column: 'received_at',
    cutoff: hookCutoff,
    // Los que todavía no se procesaron NO se borran: son los que hay que mirar.
    onlyProcessed: true,
  })

  return out
}

/** Cuánto se borra como mucho por lote. */
const PURGE_BATCH = 5_000
/** Cuántos lotes por corrida, para no comerse el timeout del cron. */
const PURGE_MAX_BATCHES = 20

/**
 * Borra en lotes lo más viejo que el corte, del lado de la base.
 *
 * Cada lote es una llamada al RPC `purge_rows_older_than` (migración 263), que
 * elige y borra las filas adentro de Postgres y devuelve cuántas fueron. Ni un
 * id viaja por la red.
 *
 * Antes se pedían 5.000 ids con `select('id')` y se mandaban de vuelta en
 * `.in('id', ids)`: PostgREST los pone en la URL, que mide ~190 KB, y
 * Cloudflare la rechaza con 414 antes de que llegue. El fallo se logueaba como
 * warn y la corrida terminaba en `ok`, así que `cron_runs` nunca se vació:
 * el 2026-09-17 tenía 924.630 filas (241 MB) y la base se quedó sin memoria.
 *
 * En lotes y no de una: `cron_runs` suma unas diez mil filas por día, y un
 * DELETE de meses enteros corre el riesgo de pasarse del timeout. Lo que sobre
 * se lleva la corrida de mañana, que para una limpieza diaria alcanza.
 */
async function deleteOlderThan(
  admin: SupabaseClient,
  opts: { table: string; column: string; cutoff: string; onlyProcessed?: boolean },
): Promise<number> {
  let total = 0
  try {
    for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
      const { data, error } = await admin.rpc('purge_rows_older_than', {
        p_table: opts.table,
        p_column: opts.column,
        p_cutoff: opts.cutoff,
        p_batch: PURGE_BATCH,
        p_only_processed: opts.onlyProcessed ?? false,
      })
      if (error) throw new Error(error.message)
      const deleted = typeof data === 'number' ? data : Number(data ?? 0)
      total += deleted
      if (deleted < PURGE_BATCH) break
    }
  } catch (err) {
    log.error(`${opts.table} purge failed`, {
      deleted: total,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return total
}

/**
 * Purga definitiva de un workspace. Cada paso es fail-soft: un fallo se
 * loguea y se sigue con el siguiente (devolvemos contadores para telemetría).
 */
async function purgeWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<{
  conversations: number
  contacts: number
  storageRemoved: number
}> {
  // 1) Borrar conversaciones del workspace. Cascada (migration 001/013):
  //    messages → comments_meta. Hacemos el delete con returning para contar.
  let conversations = 0
  try {
    const { data, error } = await admin
      .from('conversations')
      .delete()
      .eq('workspace_id', workspaceId)
      .select('id')
    if (error) throw error
    conversations = (data ?? []).length
  } catch (err) {
    log.error('delete conversations failed', {
      workspace_id: workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // 2) Borrar contactos del workspace. Cualquier conversación residual
  //    (sin contacto, o creada entre el paso 1 y este) cae por cascada
  //    contact_id → conversations → messages.
  let contacts = 0
  try {
    const { data, error } = await admin
      .from('contacts')
      .delete()
      .eq('workspace_id', workspaceId)
      .select('id')
    if (error) throw error
    contacts = (data ?? []).length
  } catch (err) {
    log.error('delete contacts failed', {
      workspace_id: workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // 3) Borrar archivos en Storage bajo el prefijo del workspace.
  let storageRemoved = 0
  try {
    storageRemoved = await purgeWorkspaceStorage(admin, workspaceId)
  } catch (err) {
    log.error('purge storage failed', {
      workspace_id: workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  log.info('workspace purged', {
    workspace_id: workspaceId,
    conversations,
    contacts,
    storageRemoved,
  })
  return { conversations, contacts, storageRemoved }
}

/**
 * Borra todos los objetos del bucket `message-media` bajo `${workspaceId}/`.
 * Los adjuntos se guardan como `${workspaceId}/${conversationId}/${id}.ext`
 * (ver lib/channels/media-ingest.ts → buildStoragePath), así que listamos
 * un nivel de subcarpetas (conversationId) y removemos sus archivos.
 */
type StorageEntry = { name: string; id?: string | null }

/**
 * `storage.list` topa en 1000 entries por página; sin paginar, un workspace
 * con >1000 conversaciones (o una conversación con >1000 adjuntos) dejaría
 * archivos de PII sin borrar de forma silenciosa. Paginamos con offset hasta
 * recibir menos de PAGE entries.
 */
async function listAllStorage(
  bucket: ReturnType<SupabaseClient['storage']['from']>,
  prefix: string,
): Promise<{ data: StorageEntry[] | null; error: { message: string } | null }> {
  const PAGE = 1000
  const all: StorageEntry[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset })
    if (error) return { data: null, error }
    const batch = (data ?? []) as StorageEntry[]
    all.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return { data: all, error: null }
}

async function purgeWorkspaceStorage(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const bucket = admin.storage.from(MEDIA_BUCKET)

  // Subcarpetas = conversationId. `list` devuelve "carpetas" como entries
  // sin `id` (metadata null); los archivos traen metadata.
  const { data: folders, error: listErr } = await listAllStorage(
    bucket,
    workspaceId,
  )
  if (listErr) {
    // Bucket inexistente o error de permisos: nada que purgar (fail-soft).
    log.warn('storage list failed', {
      workspace_id: workspaceId,
      error: listErr.message,
    })
    return 0
  }

  const paths: string[] = []
  for (const entry of folders ?? []) {
    const isFolder = (entry as { id?: string | null }).id == null
    if (isFolder) {
      // Listar los archivos dentro de la subcarpeta del conversationId.
      const sub = `${workspaceId}/${entry.name}`
      const { data: files, error: subErr } = await listAllStorage(bucket, sub)
      if (subErr) {
        log.warn('storage sublist failed', {
          workspace_id: workspaceId,
          folder: sub,
          error: subErr.message,
        })
        continue
      }
      for (const f of files ?? []) {
        paths.push(`${sub}/${f.name}`)
      }
    } else {
      paths.push(`${workspaceId}/${entry.name}`)
    }
  }

  if (paths.length === 0) return 0

  // `remove` acepta hasta ~1000 paths por llamada; troceamos por las dudas.
  let removed = 0
  for (let i = 0; i < paths.length; i += 1000) {
    const chunk = paths.slice(i, i + 1000)
    const { error: rmErr } = await bucket.remove(chunk)
    if (rmErr) {
      log.warn('storage remove failed', {
        workspace_id: workspaceId,
        count: chunk.length,
        error: rmErr.message,
      })
      continue
    }
    removed += chunk.length
  }
  return removed
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("pii-purge", cronHandler);
