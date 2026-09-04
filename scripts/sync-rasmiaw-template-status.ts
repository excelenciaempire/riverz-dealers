/* Syncs the Meta review status of the Rasmiaw template set into the local catalog. */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'

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

function localStatus(raw: string): 'Pending' | 'Approved' | 'Rejected' {
  if (raw === 'APPROVED') return 'Approved'
  if (raw === 'REJECTED' || raw === 'PAUSED' || raw === 'DISABLED') return 'Rejected'
  return 'Pending'
}

async function main() {
  const { resolverWabaYToken } = await import('@/lib/templates/create')
  const { data: templates, error } = await db
    .from('message_templates')
    .select('id, user_id, name, meta_template_id')
    .eq('workspace_id', WORKSPACE_ID)
    .like('name', 'rasmiaw_%')
    .not('meta_template_id', 'is', null)
  if (error) throw new Error(error.message)
  const userId = templates[0]?.user_id ?? null
  const { accessToken } = await resolverWabaYToken(db, WORKSPACE_ID, userId)
  if (!accessToken) throw new Error('WhatsApp no está conectado.')

  const statuses = await Promise.all(templates.map(async (template) => {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${template.meta_template_id}?fields=name,status,rejected_reason`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!response.ok) throw new Error(`Meta no devolvió ${template.name}: ${response.status}`)
    const remote = await response.json() as { status?: string; rejected_reason?: string | null }
    const raw = String(remote.status ?? 'PENDING').toUpperCase()
    const { error: updateError } = await db.from('message_templates').update({
      status: localStatus(raw),
      meta_status: raw,
      rejected_reason: remote.rejected_reason ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', template.id)
    if (updateError) throw new Error(updateError.message)
    return { name: template.name, status: raw }
  }))
  console.log(JSON.stringify({ statuses }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
