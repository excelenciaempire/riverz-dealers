/**
 * Ejecutar lo que una persona aprobó.
 *
 * Este es el único camino por el que el Operator cambia algo, y empieza en un
 * click. El modelo no llega hasta acá: lo que ejecuta son los argumentos que
 * quedaron guardados cuando se propuso, no lo que el modelo diga después. Si
 * hicieran falta otros argumentos, sería otra propuesta.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { findCapability } from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { operatorCanUse } from './capabilities'
import type { Locale } from '@/lib/i18n/config'

export interface OperatorAction {
  id: string
  capability_key: string
  args: Record<string, unknown>
  risk: 'lectura' | 'reversible' | 'irreversible'
  status: 'propuesto' | 'ejecutado' | 'rechazado' | 'fallido'
  preview: string | null
  result: unknown
  created_at: string
}

/**
 * Los datos personales no viajan a la auditoría de plataforma.
 *
 * Es el mismo criterio del MCP: /admin es solo-metadatos, y una acción puede
 * llevar el texto de un mensaje o un teléfono adentro.
 */
const CAMPOS_PII = new Set(['telefono', 'phone', 'texto', 'text', 'email'])

function sinPii(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) out[k] = CAMPOS_PII.has(k) ? '[oculto]' : v
  return out
}

async function anotar(
  db: SupabaseClient,
  input: {
    workspaceId: string
    userId: string
    key: string
    args: Record<string, unknown>
    risk: string
    ok: boolean
    summary: string
  },
): Promise<void> {
  try {
    await db.from('platform_audit_log').insert({
      workspace_id: input.workspaceId,
      actor: `operator:${input.userId}`,
      tool: input.key,
      args: sinPii(input.args),
      risk: input.risk,
      ok: input.ok,
      summary: input.summary.slice(0, 500),
    })
  } catch {
    /* el registro no puede tumbar la operación */
  }
}

export async function decideOperatorAction(
  db: SupabaseClient,
  input: {
    actionId: string
    workspaceId: string
    userId: string
    aprobar: boolean
    locale?: Locale
  },
): Promise<{ ok: boolean; status: string; message: string; result?: unknown }> {
  // El UPDATE condicionado a `propuesto` es lo que evita que dos clicks
  // ejecuten la misma acción dos veces: el segundo no encuentra fila.
  const { data, error } = await db
    .from('operator_actions')
    .update({
      status: input.aprobar ? 'ejecutado' : 'rechazado',
      approved_by: input.userId,
      executed_at: new Date().toISOString(),
    })
    .eq('id', input.actionId)
    .eq('workspace_id', input.workspaceId)
    .eq('status', 'propuesto')
    .select('id, capability_key, args, risk')
    .maybeSingle()

  if (error) return { ok: false, status: 'fallido', message: error.message }
  if (!data) {
    return { ok: false, status: 'resuelta', message: 'Esa acción ya estaba resuelta.' }
  }

  const fila = data as {
    id: string
    capability_key: string
    args: Record<string, unknown>
    risk: string
  }

  if (!input.aprobar) {
    return { ok: true, status: 'rechazado', message: 'Listo, no se hizo nada.' }
  }

  const cap = operatorCanUse(fila.capability_key, input.workspaceId)
    ? findCapability(fila.capability_key)
    : undefined
  if (!cap) {
    await db
      .from('operator_actions')
      .update({ status: 'fallido', result: { error: 'capacidad no disponible' } })
      .eq('id', fila.id)
    return {
      ok: false,
      status: 'fallido',
      message: 'Esa acción ya no está disponible.',
    }
  }

  const ctx: CapabilityContext = {
    db,
    workspaceId: input.workspaceId,
    actor: { type: 'operator', id: input.userId },
    locale: input.locale ?? 'es',
  }

  try {
    const result = await cap.run(ctx, fila.args)
    await db
      .from('operator_actions')
      .update({ result: result ?? null })
      .eq('id', fila.id)
    await anotar(db, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      key: fila.capability_key,
      args: fila.args,
      risk: fila.risk,
      ok: true,
      summary: JSON.stringify(result ?? {}).slice(0, 300),
    })
    return { ok: true, status: 'ejecutado', message: 'Hecho.', result }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'falló'
    await db
      .from('operator_actions')
      .update({ status: 'fallido', result: { error: motivo } })
      .eq('id', fila.id)
    await anotar(db, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      key: fila.capability_key,
      args: fila.args,
      risk: fila.risk,
      ok: false,
      summary: motivo,
    })
    return { ok: false, status: 'fallido', message: motivo }
  }
}
