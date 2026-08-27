import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { contextoDeLaCuenta } from '@/lib/operacion/contexto'
import {
  bloquesVisibles,
  faltantes,
  normalizarPliego,
  type BloquePliego,
  type ContextoPliego,
  type Respuestas,
} from '@/lib/operacion/pliego'

/**
 * El pliego de la marca: lo que sólo el comercio puede contestar.
 *
 * GET   → los bloques que le corresponden a esta cuenta, y lo ya contestado
 * PATCH → guarda respuestas y devuelve la lista recalculada
 *
 * Qué se muestra depende de dos cosas —qué tiene conectado y qué ya contestó—,
 * y las dos se resuelven ACÁ, no en el navegador. Si el navegador decidiera
 * qué preguntar, la pantalla y lo que después lee el Operador podrían no ser
 * la misma lista. Por eso el PATCH devuelve los bloques ya recalculados: al
 * contestar "sí trabajo contraentrega" aparece la pregunta por las zonas sin
 * que el cliente tenga que saber esa regla.
 *
 * Sólo se guarda lo contestado. Lo que falta NO se persiste con su valor por
 * defecto: así el día que un defecto cambie —siempre hacia el lado seguro— las
 * cuentas a medio contestar se mueven con él, en vez de quedar congeladas en
 * una decisión que nadie tomó.
 */
export const dynamic = 'force-dynamic'

interface Ctx {
  admin: ReturnType<typeof supabaseAdmin>
  workspaceId: string
}

async function contexto(): Promise<Ctx | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return null
  return { admin, workspaceId }
}

/** Los bloques sin las funciones: lo que puede viajar por JSON. */
function serializar(bloques: BloquePliego[]) {
  return bloques.map((b) => ({
    id: b.id,
    tituloKey: b.tituloKey,
    notaKey: b.notaKey ?? null,
    preguntas: b.preguntas.map((p) => ({
      id: p.id,
      labelKey: p.labelKey,
      ayudaKey: p.ayudaKey ?? null,
      tipo: p.tipo,
      opciones: p.opciones ?? null,
      porDefecto: p.porDefecto,
      min: p.min ?? null,
      max: p.max ?? null,
    })),
  }))
}

async function leer(ctx: Ctx): Promise<{
  respuestas: Respuestas
  cuenta: ContextoPliego
}> {
  const [{ data }, cuenta] = await Promise.all([
    ctx.admin
      .from('operacion_setup')
      .select('pliego')
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle(),
    contextoDeLaCuenta(ctx.admin, ctx.workspaceId),
  ])
  const guardado = (data as { pliego?: Respuestas } | null)?.pliego ?? {}
  return { respuestas: normalizarPliego(guardado), cuenta }
}

function respuesta(respuestas: Respuestas, cuenta: ContextoPliego) {
  return NextResponse.json(
    {
      bloques: serializar(bloquesVisibles(cuenta, respuestas)),
      respuestas,
      cuenta,
      faltantes: faltantes(cuenta, respuestas),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET() {
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })
  const { respuestas, cuenta } = await leer(ctx)
  return respuesta(respuestas, cuenta)
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as {
    respuestas?: unknown
  } | null

  const { respuestas: previas, cuenta } = await leer(ctx)
  // Merge y no reemplazo: la pantalla manda lo que se tocó, no el pliego
  // entero. Reemplazar borraría lo contestado en otra sesión —o en la reunión,
  // desde otra computadora— sin que nadie lo pida.
  const merged = { ...previas, ...normalizarPliego(body?.respuestas) }

  const { error } = await ctx.admin.from('operacion_setup').upsert(
    {
      workspace_id: ctx.workspaceId,
      pliego: merged,
      pliego_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return respuesta(merged, cuenta)
}
