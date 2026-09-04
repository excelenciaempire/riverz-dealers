/*
 * Emergency-safe bridge for environments that have not received migration 240
 * yet. It only turns the four Rasmiaw flows off and leaves an audit record.
 */
import 'dotenv/config'

import { supabaseAdmin } from '@/lib/automations/admin-client'

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'
const NAMES = [
  'Rasmiaw · Nuevo pedido',
  'Rasmiaw · Carrito abandonado',
  'Rasmiaw · Pago rechazado',
  'Rasmiaw · Envío',
]

async function main() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('automations')
    .update({ is_active: false })
    .eq('workspace_id', WORKSPACE_ID)
    .in('name', NAMES)
    .is('deleted_at', null)
    .select('id, name')
  if (error) throw error

  const result = {
    paused: (data ?? []).map((row) => row.name),
    reason: 'La cuenta espera dependencias Meta/Mercado Pago; migration 240 aplicará el estado armed.',
  }
  const { error: auditError } = await db.from('operator_actions').insert({
    workspace_id: WORKSPACE_ID,
    capability_key: 'rasmiaw.armar_operacion_rasmiaw',
    args: { source: 'migration-bridge' },
    risk: 'reversible',
    status: 'ejecutado',
    result,
    preview: 'Pausar los flujos que no pueden enviar hasta que Meta y sus plantillas estén listas.',
    executed_at: new Date().toISOString(),
  })
  if (auditError) throw auditError
  console.log(JSON.stringify({ ok: true, ...result }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
