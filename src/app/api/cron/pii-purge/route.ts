import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from "@/lib/cron/heartbeat";
import { getLogger } from '@/lib/log/logger'

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

  // 207 si algún workspace falló, para que el monitor de Render lo marque.
  const status = failed > 0 ? 207 : 200
  return NextResponse.json(
    { candidates: targets.length, purged, failed, graceDays, results },
    { status },
  )
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
