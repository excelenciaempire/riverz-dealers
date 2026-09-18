/*
 * Diagnóstico: ¿por qué un adjunto de Instagram termina como URL pelada en la
 * bandeja? Toma el último mensaje entrante de Instagram cuyo texto es una URL
 * del CDN de Meta, y prueba los tres caminos de `ingestMetaAttachment` uno por
 * uno, imprimiendo qué contesta cada uno (status, content-type, primeros
 * bytes). No guarda nada ni imprime tokens.
 *
 *   npx tsx scripts/diag-instagram-attachment.ts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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

async function peek(label: string, url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    const buf = Buffer.from(await res.arrayBuffer())
    const head = buf.subarray(0, 80).toString('latin1').replace(/\s+/g, ' ')
    console.log(`${label}: HTTP ${res.status} ct=${res.headers.get('content-type')} bytes=${buf.length} head=${JSON.stringify(head)}`)
    return { res, buf }
  } catch (err) {
    console.log(`${label}: ERROR ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function main() {
  const { decrypt } = await import('@/lib/channels/encryption')
  const { appsecretProof } = await import('@/lib/channels/meta-graph')

  const { data: rows } = await db
    .from('messages')
    .select('id, message_id, content_text, created_at, conversation_id, conversations(workspace_id)')
    .eq('channel', 'instagram')
    .eq('sender_type', 'customer')
    .like('content_text', 'https://lookaside.fbsbx.com/%')
    .order('created_at', { ascending: false })
    .limit(1)
  const row = rows?.[0] as { message_id: string; content_text: string; created_at: string; conversations: { workspace_id: string } | { workspace_id: string }[] } | undefined
  if (!row) { console.log('no hay mensajes con URL pelada'); return }
  const ws = Array.isArray(row.conversations) ? row.conversations[0]?.workspace_id : row.conversations?.workspace_id
  console.log('mensaje', row.created_at, 'mid', row.message_id, 'workspace', ws)
  const cdnUrl = row.content_text.split('\n')[0].trim()

  const { data: conn } = await db
    .from('channel_connections')
    .select('config, secrets, external_account_id')
    .eq('workspace_id', ws)
    .eq('channel', 'instagram')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle()
  const secrets = ((conn as { secrets?: Record<string, unknown> } | null)?.secrets ?? {}) as Record<string, unknown>
  const token = secrets.access_token ? decrypt(String(secrets.access_token)) : ''
  console.log('token presente:', Boolean(token), 'largo', token.length)

  // 1. CDN anónimo
  await peek('1 cdn anonimo', cdnUrl)
  // 2. CDN con token
  await peek('2 cdn con token', cdnUrl, { Authorization: `Bearer ${token}` })
  // 3. Graph por mid
  const url = new URL(`https://graph.facebook.com/v22.0/${encodeURIComponent(row.message_id)}`)
  url.searchParams.set('fields', 'attachments{image_data,video_data,file_url}')
  url.searchParams.set('access_token', token)
  const proof = appsecretProof(token)
  if (proof) url.searchParams.set('appsecret_proof', proof)
  const g = await peek('3 graph por mid', url.toString())
  if (g) {
    const body = g.buf.toString('utf8').replace(token, '<token>')
    console.log('   graph body:', body.slice(0, 600))
    try {
      const json = JSON.parse(body) as { attachments?: { data?: Array<Record<string, unknown>> } }
      const a = json.attachments?.data?.[0] ?? {}
      const fresh = ((a.image_data ?? a.video_data ?? {}) as { url?: string }).url ?? (a.file_url as string | undefined)
      if (fresh) await peek('4 url fresca de graph', fresh)
    } catch { /* no era JSON */ }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
