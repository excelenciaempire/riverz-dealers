/*
 * DeUNA Shop integró Mercado Pago y tarjeta en su Shopify (2026-09-18). Un
 * pedido ya pagado no puede recibir "Pagas al recibir" —la barrera de DeUNA lo
 * salta— y hasta hoy no recibía nada. Esta plantilla es la confirmación para
 * ese caso. Sólo manda los borradores a Meta; no activa automatizaciones ni
 * escribe a ningún cliente.
 *
 *   npx tsx scripts/publish-deuna-compra-pagada.ts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { TemplateButtonInput } from '@/lib/whatsapp/template-components'

const WORKSPACE_ID = '36f81b96-41b9-4d29-b72e-11be3d3070a3'
const NAME = 'deuna_compra_pagada_producto_v1'

const VERSIONES: Array<{
  language: 'es' | 'en'
  body: string
  buttons: TemplateButtonInput[]
  samples: string[]
}> = [
  {
    language: 'es',
    body: `Hola, {{1}} 😊 ¡Gracias por tu compra!

Ya recibimos tu pago y estamos preparando:
{{2}}

Lo enviamos a: {{3}}
Tu teléfono: {{4}}

Si algún dato cambió, toca CORREGIR y dime cuál. Te aviso apenas salga el envío.`,
    buttons: [
      { type: 'QUICK_REPLY', text: 'TODO BIEN' },
      { type: 'QUICK_REPLY', text: 'CORREGIR' },
    ],
    samples: ['Ana', '1 × Pelota saltarina LED (Cerdita Rosa)', 'Calle 10 # 20-30, Cali', '+573000000000'],
  },
  {
    language: 'en',
    body: `Hi, {{1}} 😊 Thanks for your purchase!

We received your payment and we're preparing:
{{2}}

Shipping to: {{3}}
Your phone: {{4}}

If anything changed, tap CORRECT and tell me what. I'll let you know as soon as it ships.`,
    buttons: [
      { type: 'QUICK_REPLY', text: 'ALL GOOD' },
      { type: 'QUICK_REPLY', text: 'CORRECT' },
    ],
    samples: ['Ana', '1 × LED bouncing ball (Pink Pig)', '10th Street # 20-30, Cali', '+573000000000'],
  },
]

const VARIABLE_FIELDS = {
  '1': 'contact_first_name',
  '2': 'order_items',
  '3': 'delivery_address',
  '4': 'delivery_phone',
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
  // `decrypt()` captura ENCRYPTION_KEY al evaluar el módulo: importar después
  // de cargar `.env.local`.
  const { crearPlantilla } = await import('@/lib/templates/create')

  const { data: members, error: memberError } = await db
    .from('workspace_members').select('user_id, role').eq('workspace_id', WORKSPACE_ID).order('joined_at').limit(1)
  if (memberError) throw new Error(memberError.message)
  const ownerId = members?.[0]?.user_id
  if (!ownerId) throw new Error('No se encontró al dueño de DeUNA.')

  const results: Array<Record<string, unknown>> = []
  for (const v of VERSIONES) {
    const { data: old, error: oldError } = await db
      .from('message_templates').select('id, status')
      .eq('workspace_id', WORKSPACE_ID).eq('name', NAME).eq('language', v.language).maybeSingle()
    if (oldError) throw new Error(oldError.message)
    if (old && String(old.status).toLowerCase() !== 'draft') {
      results.push({ language: v.language, skipped: String(old.status) })
      continue
    }
    const result = await crearPlantilla(db, {
      workspaceId: WORKSPACE_ID,
      userId: ownerId,
      nombre: NAME,
      idioma: v.language,
      categoria: 'UTILITY',
      headerType: 'none',
      bodyText: v.body,
      buttons: v.buttons,
      bodySamples: v.samples,
      variableFields: VARIABLE_FIELDS,
      plantillaExistenteId: old?.id ?? null,
      enviarAMeta: true,
    })
    results.push(result.ok
      ? { language: v.language, status: result.estado, metaStatus: result.estadoMeta }
      : { language: v.language, status: 'failed', detail: result.mensaje ?? result.claveI18n ?? 'unknown' })
  }
  console.log(JSON.stringify({ results }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
