/*
 * Submits only the eight local Rasmiaw drafts to Meta for approval.
 * It never activates automations or sends customer messages.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { TemplateButtonInput, TemplateHeaderType } from '@/lib/whatsapp/template-components'

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'
const TEMPLATE_NAMES = [
  'rasmiaw_preparando_pedido',
  'rasmiaw_beneficio_contraentrega_v2',
  'rasmiaw_recordatorio_contraentrega_v2',
  'rasmiaw_ultima_oportunidad_contraentrega_v2',
  'rasmiaw_carrito_abandonado_1',
  'rasmiaw_carrito_abandonado_2',
  'rasmiaw_pago_rechazado',
  'rasmiaw_envio_tracking',
] as const

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
  // `decrypt()` captures ENCRYPTION_KEY at module evaluation time, so this
  // import must happen after `.env.local` is loaded above.
  const { crearPlantilla } = await import('@/lib/templates/create')
  const { data: templates, error } = await db
    .from('message_templates')
    .select('id, user_id, name, language, category, header_type, header_content, body_text, footer_text, buttons, variable_samples, variable_fields, status')
    .eq('workspace_id', WORKSPACE_ID)
    .in('name', [...TEMPLATE_NAMES])
    .eq('language', 'es')
    .order('name')
  if (error) throw new Error(error.message)
  if (templates.length !== TEMPLATE_NAMES.length) {
    throw new Error('Faltan borradores de Rasmiaw; vuelve a ejecutar el aprovisionamiento antes de publicar.')
  }

  const results: Array<Record<string, unknown>> = []
  for (const row of templates) {
    if (String(row.status).toLowerCase() !== 'draft') {
      results.push({ name: row.name, skipped: String(row.status) })
      continue
    }
    const result = await crearPlantilla(db, {
      workspaceId: WORKSPACE_ID,
      userId: row.user_id,
      nombre: row.name,
      idioma: row.language,
      categoria: String(row.category).toUpperCase(),
      headerType: (row.header_type ?? 'none') as TemplateHeaderType,
      headerText: row.header_content ?? undefined,
      bodyText: row.body_text,
      footerText: row.footer_text ?? undefined,
      buttons: (row.buttons ?? undefined) as TemplateButtonInput[] | undefined,
      bodySamples: (row.variable_samples ?? undefined) as string[] | undefined,
      variableFields: (row.variable_fields ?? undefined) as Record<string, string> | undefined,
      plantillaExistenteId: row.id,
      enviarAMeta: true,
    })
    results.push(result.ok
      ? { name: row.name, status: result.estado, metaStatus: result.estadoMeta }
      : { name: row.name, status: 'failed', detail: result.mensaje ?? result.claveI18n ?? 'unknown' })
  }
  console.log(JSON.stringify({ results }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
