/*
 * Rasmiaw: recordatorios de confirmación de contra entrega como UTILIDAD.
 *
 * La secuencia mandaba tres plantillas de MARKETING en 27 h (beneficio,
 * recordatorio, última oportunidad) y Meta topea el marketing por persona:
 * 20 rechazos 131049 en 3 días, casi todos en el 2.º y 3.º toque. Estas dos
 * no tienen descuento en el texto —son la pregunta "¿confirmas tu pedido?"—
 * así que califican como utilidad y no entran en ese tope. El beneficio se
 * lo cuenta el asistente cuando la persona responde (sesión abierta).
 *
 *   npx tsx scripts/publish-rasmiaw-confirmacion-utility.ts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { TemplateButtonInput } from '@/lib/whatsapp/template-components'

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'

const BOTONES: TemplateButtonInput[] = [
  { type: 'QUICK_REPLY', text: 'MANTENER CONTRAENTREGA' },
  { type: 'QUICK_REPLY', text: 'CAMBIAR PAGO' },
]

const PLANTILLAS = [
  {
    name: 'rasmiaw_confirmar_pedido_v1',
    body: `Tu pedido de Rasmiaw sigue pendiente de confirmación. 😻

Para programar la entrega necesitamos que confirmes tu pago contra entrega.

Responde MANTENER CONTRAENTREGA para confirmar tu pedido tal como está.

Responde CAMBIAR PAGO si prefieres pagar por transferencia, Llave, Bold o Addi.`,
  },
  {
    name: 'rasmiaw_pedido_sin_confirmar_v1',
    body: `Último aviso sobre tu pedido de Rasmiaw. 🐾

Sigue sin confirmar y no podemos programar la entrega sin tu respuesta.

Responde MANTENER CONTRAENTREGA para confirmarlo, o CAMBIAR PAGO si prefieres otra forma de pago.`,
  },
]

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
  const { crearPlantilla } = await import('@/lib/templates/create')
  const { data: members, error: memberError } = await db
    .from('workspace_members').select('user_id').eq('workspace_id', WORKSPACE_ID).order('joined_at').limit(1)
  if (memberError) throw new Error(memberError.message)
  const ownerId = members?.[0]?.user_id
  if (!ownerId) throw new Error('No se encontró al dueño de Rasmiaw.')

  const results: Array<Record<string, unknown>> = []
  for (const p of PLANTILLAS) {
    const { data: old } = await db
      .from('message_templates').select('id, status')
      .eq('workspace_id', WORKSPACE_ID).eq('name', p.name).eq('language', 'es').maybeSingle()
    if (old && String(old.status).toLowerCase() !== 'draft') {
      results.push({ name: p.name, skipped: String(old.status) })
      continue
    }
    const result = await crearPlantilla(db, {
      workspaceId: WORKSPACE_ID,
      userId: ownerId,
      nombre: p.name,
      idioma: 'es',
      categoria: 'UTILITY',
      headerType: 'none',
      bodyText: p.body,
      buttons: BOTONES,
      plantillaExistenteId: old?.id ?? null,
      enviarAMeta: true,
    })
    results.push(result.ok
      ? { name: p.name, status: result.estado, metaStatus: result.estadoMeta }
      : { name: p.name, status: 'failed', detail: result.mensaje ?? result.claveI18n ?? 'unknown' })
  }
  console.log(JSON.stringify({ results }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
