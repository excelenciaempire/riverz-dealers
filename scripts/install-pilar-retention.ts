import { createClient } from '@supabase/supabase-js'
import { installRetentionPackage } from '../src/lib/automations/install-retention'
import { resolveWorkspaceOwnerUserId } from '../src/lib/workspaces/owner'
import { writeFile, mkdir } from 'node:fs/promises'

async function main() {
  const args = process.argv.slice(2)
  const workspaceId = args[args.indexOf('--workspace') + 1]
  if (!args.includes('--workspace') || !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error('--workspace UUID is required')
  const offers = [{ units: 1, day: 22, label: '1 unidad' }, { units: 3, day: 82, label: '2 unidades + 1 gratis' }, { units: 4, day: 112, label: '3 unidades + 1 gratis' }]
  if (!args.includes('--apply')) { console.log(JSON.stringify({ workspaceId, offers, mode: 'preview', active: false })); return }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const owner = await resolveWorkspaceOwnerUserId(db, workspaceId)
  if (!owner) throw new Error('Workspace owner missing')
  const { data: product, error } = await db.from('shopify_products').select('id').eq('workspace_id', workspaceId).eq('title', 'Serum Pilar').limit(1)
  if (error || !product?.length) throw new Error('Serum Pilar is not present in this workspace')
  const { data: agents } = await db.from('ai_agents').select('id,name,is_active').eq('workspace_id', workspaceId).eq('is_active', true)
  const agent = agents?.find(a => /asesora/i.test(String(a.name)))
  const result = await installRetentionPackage(db, { workspaceId, userId: owner, locale: 'es', product: 'Serum Pilar', offers,
    installationKey: 'pilar_postventa_v1', ...(agent ? { handoffAgentId: agent.id } : {}) })
  await mkdir('output/retention', { recursive: true })
  await writeFile('output/retention/pilar-installation.json', JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result, null, 2))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
