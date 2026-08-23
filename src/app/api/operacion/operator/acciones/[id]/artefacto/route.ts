import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { artefactoGuardadoDeAgente } from '@/lib/capabilities/agents'
import { artefactoGuardadoDeAutomatizacion } from '@/lib/capabilities/automations'
import { artefactoGuardadoDeCampana } from '@/lib/capabilities/broadcasts'
import { artefactoGuardadoDeSegmento } from '@/lib/capabilities/contacts'
import { artefactoGuardadoDeFlujo } from '@/lib/capabilities/flows'
import { artefactoGuardadoDePlantilla } from '@/lib/capabilities/outbound'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { getLocale } from '@/lib/i18n/server'
import { esArtefacto, type Artefacto } from '@/lib/operator/artifacts'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cómo quedó, de verdad.
 *
 * El chat guarda con cada acción el artefacto que CALCULÓ al proponerla, desde
 * los argumentos del modelo. Sirve para decidir si aprobarla; no sirve para
 * mirar cómo quedó, porque entre una cosa y la otra pasan las que importan: los
 * nombres se convierten en ids, un paso puede no haber entrado, y una etiqueta
 * puede no existir. Justamente ahí estaba escondida una automatización que se
 * veía bien en el chat y no podía funcionar.
 *
 * Así que esto lee la entidad de la base y la vuelve a dibujar. Si ya no está
 * —la borraron, o el tipo todavía no tiene lector— cae al artefacto guardado y
 * lo dice, en vez de mostrar una pantalla vacía.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })
  if (!isRiverz2(await getFeatureFlags(admin, workspaceId))) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }

  const { data } = await admin
    .from('operator_actions')
    .select('id, capability_key, artifact, result, status')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const fila = data as {
    capability_key: string
    artifact: unknown
    result: { id?: string } | null
    status: string
  } | null
  if (!fila) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const ctx: CapabilityContext = {
    db: admin,
    workspaceId,
    actor: { type: 'operator', id: user.id },
    locale: await getLocale(),
  }

  const entidadId = typeof fila.result?.id === 'string' ? fila.result.id : null
  let artefacto: Artefacto | null = null
  let real = false

  /**
   * Quién sabe releer cada pieza de la base.
   *
   * Las seis, no dos. Con sólo automatizaciones y plantillas acá, mirar «cómo
   * quedó» un agente, un segmento, una campaña o un menú devolvía el dibujo
   * PROPUESTO marcado como si fuera el guardado — que es la misma confusión que
   * escondió una automatización rota, sólo que en cuatro dominios más.
   */
  const RELEER: Record<string, (id: string) => Promise<Artefacto | null>> = {
    'automatizaciones.': (id) => artefactoGuardadoDeAutomatizacion(ctx, id),
    'plantillas.': (id) => artefactoGuardadoDePlantilla(ctx, id),
    'agentes.': (id) => artefactoGuardadoDeAgente(ctx, id),
    'segmentos.': (id) => artefactoGuardadoDeSegmento(ctx, id),
    'campanas.': (id) => artefactoGuardadoDeCampana(ctx, id),
    'flujos.': (id) => artefactoGuardadoDeFlujo(ctx, id),
  }

  if (entidadId) {
    const releer = Object.entries(RELEER).find(([p]) => fila.capability_key.startsWith(p))?.[1]
    try {
      if (releer) artefacto = await releer(entidadId)
      real = artefacto !== null
    } catch {
      // Se borró, o cambió de cuenta. Abajo está el respaldo.
      artefacto = null
    }
  }

  if (!artefacto && esArtefacto(fila.artifact)) artefacto = fila.artifact

  if (!artefacto) return NextResponse.json({ error: 'sin_dibujo' }, { status: 404 })

  return NextResponse.json(
    {
      artefacto,
      /** `false` = es lo que se propuso, no lo que quedó guardado. */
      real,
      entidadId,
      status: fila.status,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
