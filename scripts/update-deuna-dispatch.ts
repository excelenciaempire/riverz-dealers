/** Publica la plantilla de despacho v2 y la activa cuando Meta la aprueba. */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const workspaceId = '36f81b96-41b9-4d29-b72e-11be3d3070a3'
const automationName = 'DeUNA Shop · Pedido despachado'
const templateName = 'deuna_pedido_despachado_v2'

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
  if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const siteBase = /^https:\/\//i.test(process.env.NEXT_PUBLIC_SITE_URL ?? '') &&
  !/localhost|127\.0\.0\.1/i.test(process.env.NEXT_PUBLIC_SITE_URL ?? '')
  ? process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/+$/, '')
  : 'https://riverz.co'

async function main() {
  const { crearPlantilla } = await import('@/lib/templates/create')
  const { reconcileWorkspaceAutomationReadiness } = await import('@/lib/automations/activation')

  const { data: flow, error: flowError } = await db
    .from('automations')
    .select('id,user_id')
    .eq('workspace_id', workspaceId)
    .eq('name', automationName)
    .is('deleted_at', null)
    .single()
  if (flowError) throw flowError

  const { data: existing, error: templateError } = await db
    .from('message_templates')
    .select('id,status')
    .eq('workspace_id', workspaceId)
    .eq('name', templateName)
    .eq('language', 'es')
    .maybeSingle()
  if (templateError) throw templateError

  let status = String(existing?.status ?? 'Draft')
  if (!existing || status.toLowerCase() === 'draft') {
    const result = await crearPlantilla(db, {
      workspaceId,
      userId: flow.user_id,
      nombre: templateName,
      idioma: 'es',
      categoria: 'UTILITY',
      headerType: 'none',
      bodyText: '¡Buenas noticias! Tu pedido {{1}} ya está en camino. 🚚✨\n\nTransportadora: {{2}}\nGuía: {{3}}\n\nPulsa el botón para seguir su recorrido. Si necesitas ayuda, escríbenos por aquí.',
      buttons: [{
        type: 'URL',
        text: 'Rastrear mi pedido',
        url: `${siteBase}/r/{{1}}`,
        url_variable: 'tracking',
      }],
      bodySamples: ['#1004', 'Envía', '024034940186'],
      variableFields: { '1': 'order_number', '2': 'tracking_company', '3': 'tracking_number' },
      plantillaExistenteId: existing?.id,
      enviarAMeta: true,
    })
    if (!result.ok) throw new Error(result.mensaje ?? result.claveI18n)
    status = String(result.estado)
  }

  let promoted = false
  if (status.toLowerCase() === 'approved') {
    const { data: steps, error: stepError } = await db
      .from('automation_steps')
      .select('id,step_config')
      .eq('automation_id', flow.id)
    if (stepError) throw stepError

    for (const step of steps ?? []) {
      if (!['deuna_pedido_despachado', templateName].includes(String(step.step_config?.template_name ?? ''))) continue
      const { error: updateError } = await db
        .from('automation_steps')
        .update({
          step_config: {
            ...step.step_config,
            template_name: templateName,
            variables: {
              '1': '{{vars.order_number}}',
              '2': '{{vars.tracking_company}}',
              '3': '{{vars.tracking_number}}',
            },
          },
        })
        .eq('id', step.id)
        .eq('automation_id', flow.id)
      if (updateError) throw updateError
      promoted = true
    }
  }

  const readiness = await reconcileWorkspaceAutomationReadiness(db, workspaceId)
  const dispatch = readiness.find((row) => row.id === flow.id)
  console.log(JSON.stringify({
    template: templateName,
    status,
    promoted,
    automation: dispatch ? {
      state: dispatch.state,
      blockers: dispatch.issues.map((issue) => issue.path),
    } : null,
  }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
