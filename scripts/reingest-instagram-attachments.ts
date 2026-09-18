/*
 * Vuelve a bajar los adjuntos de Instagram que quedaron como URL pelada en la
 * bandeja (16–18 de septiembre de 2026, ver download-public-media.ts) y deja
 * el mensaje como debió quedar: con su archivo. Idempotente: sólo toca
 * mensajes entrantes de Instagram cuyo texto es una URL del CDN de Meta y que
 * no tienen media_url.
 *
 *   npx tsx scripts/reingest-instagram-attachments.ts
 */
import { readFileSync } from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// `media-ingest` importa 'server-only', que fuera de Next explota al cargarse.
// Se resuelve a un módulo vacío sólo dentro de este proceso.
const resolver = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === 'server-only') return path.join(__dirname, 'server-only-stub.cjs')
  return resolver.call(this, req, ...rest)
}

function loadEnv() {
  const values: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}
const env = loadEnv()
Object.assign(process.env, env)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { decrypt } = await import('@/lib/channels/encryption')
  const { ingestMetaAttachment } = await import('@/lib/channels/media-ingest')

  const { data: rows, error } = await db
    .from('messages')
    .select('id, message_id, content_text, created_at, conversation_id, conversations(workspace_id, contact_id)')
    .eq('channel', 'instagram')
    .eq('sender_type', 'customer')
    // Dos formas del mismo fallo: la URL pelada (desde el 16/09) y el HTML del
    // "unsupportedbrowser" guardado como documento (del 11 al 16/09).
    .or('and(media_url.is.null,content_text.like.https://lookaside.fbsbx.com/%),media_mime.like.text/html%')
    .gt('created_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const tokens = new Map<string, string>()
  const resultados: Array<Record<string, unknown>> = []
  for (const raw of rows ?? []) {
    const row = raw as unknown as {
      id: string; message_id: string; content_text: string | null; created_at: string
      conversations: { workspace_id: string; contact_id: string | null } | Array<{ workspace_id: string; contact_id: string | null }>
    }
    const conv = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations
    const ws = conv?.workspace_id
    if (!ws) continue
    if (!tokens.has(ws)) {
      const { data: conn } = await db
        .from('channel_connections').select('secrets')
        .eq('workspace_id', ws).eq('channel', 'instagram').eq('status', 'connected').limit(1).maybeSingle()
      const secrets = ((conn as { secrets?: Record<string, unknown> } | null)?.secrets ?? {}) as Record<string, unknown>
      tokens.set(ws, secrets.access_token ? decrypt(String(secrets.access_token)) : '')
    }
    const lineas = (row.content_text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    const esUrl = Boolean(lineas[0]?.startsWith('https://lookaside.fbsbx.com/'))
    // Con el HTML guardado no queda la URL original: se pide a Graph por mid.
    const url = esUrl ? lineas[0] : 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=0'
    const resto = (esUrl ? lineas.slice(1) : lineas).join('\n')
    const ingested = await ingestMetaAttachment({
      attachmentUrl: url,
      workspaceId: ws,
      conversationId: conv.contact_id ?? row.conversation_id,
      externalMessageId: `${row.message_id}-0`,
      hintedKind: 'image',
      accessToken: tokens.get(ws) || undefined,
      mid: row.message_id,
      attachmentIndex: 0,
    })
    if (!ingested) {
      resultados.push({ id: row.id, ok: false })
      continue
    }
    const { error: upErr } = await db.from('messages').update({
      media_url: ingested.url,
      media_type: ingested.mediaType,
      media_mime: ingested.mediaMime,
      media_size: ingested.mediaSize,
      attachments: [{ url: ingested.url, mime_type: ingested.mediaMime, size: ingested.mediaSize }],
      content_text: resto || null,
    }).eq('id', row.id)
    resultados.push({ id: row.id, ok: !upErr, tipo: ingested.mediaType, bytes: ingested.mediaSize, error: upErr?.message })
  }
  console.log(JSON.stringify({ total: rows?.length ?? 0, resultados }, null, 1))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
