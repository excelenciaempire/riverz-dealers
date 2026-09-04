/* Activates only Rasmiaw automations whose dependencies are currently valid. */
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

async function main() {
  const { activationIssuesById, comoSeLeen } = await import('@/lib/automations/activation')
  const { data: automations, error } = await db
    .from('automations')
    .select('id, name, is_active')
    .eq('workspace_id', WORKSPACE_ID)
    .like('name', 'Rasmiaw · %')
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  const activable: string[] = []
  const blocked: Array<{ name: string; reason: string }> = []
  for (const automation of automations) {
    if (automation.is_active) continue
    const issues = await activationIssuesById(db, automation.id, WORKSPACE_ID)
    if (issues.length === 0) activable.push(automation.id)
    else blocked.push({ name: automation.name, reason: comoSeLeen(issues, 'es') })
  }

  let activated: string[] = []
  if (activable.length > 0) {
    const { data, error: updateError } = await db.from('automations')
      .update({ is_active: true })
      .eq('workspace_id', WORKSPACE_ID)
      .in('id', activable)
      .select('name')
    if (updateError) throw new Error(updateError.message)
    if ((data ?? []).length !== activable.length) throw new Error('La activación agrupada no se completó.')
    activated = (data ?? []).map((row) => row.name)
  }
  console.log(JSON.stringify({ activated, blocked }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
