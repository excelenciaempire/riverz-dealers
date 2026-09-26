import type { SupabaseClient } from '@supabase/supabase-js'
import { COLUMNAS_DE_BORRADOR, enviarBorradorAMeta, type BorradorGuardado } from './enviar-borrador'

/**
 * Cambios de texto sobre una plantilla que ya está en Meta (migración 283).
 *
 * Meta no deja editar una plantilla en revisión y re-revisa una aprobada, así
 * que el comercio no la toca: pide el cambio desde el tablero, el equipo de
 * Riverz lo ve con el antes y el después y, al aprobarlo, se crea la versión
 * nueva (otro nombre), se manda a Meta y las automatizaciones pasan a usarla.
 * La vieja queda sin uso y se borra con "Eliminar sin usar".
 */

export interface CambioDePlantilla {
  id: string
  workspace_id: string
  plantilla_id: string | null
  plantilla_nombre: string
  antes: string
  despues: string
  estado: 'pendiente' | 'aprobado' | 'descartado' | 'fallido'
  pedido_por: string | null
  nueva_plantilla: string | null
  motivo: string | null
  created_at: string
  resuelto_at: string | null
}

export const COLUMNAS_DE_CAMBIO =
  'id, workspace_id, plantilla_id, plantilla_nombre, antes, despues, estado, pedido_por, nueva_plantilla, motivo, created_at, resuelto_at'

/** "revitaly_pago_v3" → "revitaly_pago_v4"; sin versión, "_v2". */
export function siguienteVersion(nombre: string, ocupados: Set<string>): string {
  const m = /^(.*)_v(\d+)$/.exec(nombre)
  const base = m ? m[1] : nombre
  let n = m ? Number(m[2]) + 1 : 2
  while (ocupados.has(`${base}_v${n}`)) n++
  return `${base}_v${n}`
}

/** Guarda el pedido. Uno pendiente por plantilla: el último reemplaza al anterior. */
export async function pedirCambio(
  db: SupabaseClient,
  args: { workspaceId: string; userId: string; plantilla: { id: string; name: string; body_text: string | null }; despues: string }
): Promise<CambioDePlantilla> {
  await db
    .from('cambios_de_plantilla')
    .delete()
    .eq('workspace_id', args.workspaceId)
    .eq('plantilla_id', args.plantilla.id)
    .eq('estado', 'pendiente')
  const { data, error } = await db
    .from('cambios_de_plantilla')
    .insert({
      workspace_id: args.workspaceId,
      plantilla_id: args.plantilla.id,
      plantilla_nombre: args.plantilla.name,
      antes: args.plantilla.body_text ?? '',
      despues: args.despues,
      pedido_por: args.userId,
    })
    .select(COLUMNAS_DE_CAMBIO)
    .single()
  if (error) throw error
  return data as CambioDePlantilla
}

export type ResultadoDeAprobar =
  | { ok: true; nueva: string }
  | { ok: false; motivo: string }

/** Crea la versión nueva, la manda a Meta y mueve las automatizaciones a ella. */
export async function aprobarCambio(db: SupabaseClient, cambioId: string): Promise<ResultadoDeAprobar> {
  const { data: fila } = await db.from('cambios_de_plantilla').select(COLUMNAS_DE_CAMBIO).eq('id', cambioId).maybeSingle()
  const cambio = fila as CambioDePlantilla | null
  if (!cambio || cambio.estado !== 'pendiente') return { ok: false, motivo: 'not_found' }

  const { data: original } = await db
    .from('message_templates')
    .select(COLUMNAS_DE_BORRADOR)
    .eq('workspace_id', cambio.workspace_id)
    .eq('name', cambio.plantilla_nombre)
    .maybeSingle()
  const base = original as (BorradorGuardado & { status: string | null }) | null
  if (!base) return cerrar(db, cambio.id, 'fallido', { motivo: 'La plantilla original ya no existe' })

  const { data: nombres } = await db.from('message_templates').select('name').eq('workspace_id', cambio.workspace_id)
  const nueva = siguienteVersion(base.name, new Set(((nombres ?? []) as Array<{ name: string }>).map((n) => n.name)))

  const { data: creada, error } = await db
    .from('message_templates')
    .insert({
      user_id: base.user_id,
      workspace_id: cambio.workspace_id,
      name: nueva,
      category: base.category,
      language: base.language,
      header_type: base.header_type,
      header_content: base.header_content,
      body_text: cambio.despues,
      footer_text: base.footer_text,
      buttons: base.buttons,
      variable_samples: base.variable_samples,
      variable_fields: base.variable_fields,
      status: 'Draft',
    })
    .select(COLUMNAS_DE_BORRADOR)
    .single()
  if (error || !creada) return cerrar(db, cambio.id, 'fallido', { motivo: error?.message ?? 'insert' })

  const r = await enviarBorradorAMeta(db, {
    workspaceId: cambio.workspace_id,
    userId: cambio.pedido_por,
    fila: creada as BorradorGuardado,
  })
  if (!r.ok) {
    // Sin la plantilla en Meta no se mueve nada: la vieja sigue saliendo.
    await db.from('message_templates').delete().eq('id', (creada as { id: string }).id)
    return cerrar(db, cambio.id, 'fallido', { motivo: r.mensaje ?? r.claveI18n ?? 'meta' })
  }

  const { data: autos } = await db
    .from('automations')
    .select('id')
    .eq('workspace_id', cambio.workspace_id)
    .is('deleted_at', null)
  const ids = ((autos ?? []) as Array<{ id: string }>).map((a) => a.id)
  if (ids.length) {
    const { data: pasos } = await db
      .from('automation_steps')
      .select('id, step_config')
      .in('automation_id', ids)
      .eq('step_type', 'send_template')
    for (const p of (pasos ?? []) as Array<{ id: string; step_config: Record<string, unknown> | null }>) {
      if (p.step_config?.template_name !== base.name) continue
      await db
        .from('automation_steps')
        .update({ step_config: { ...p.step_config, template_name: nueva } })
        .eq('id', p.id)
    }
  }
  await cerrar(db, cambio.id, 'aprobado', { nueva })
  return { ok: true, nueva }
}

async function cerrar(
  db: SupabaseClient,
  id: string,
  estado: 'aprobado' | 'descartado' | 'fallido',
  extra: { motivo?: string; nueva?: string }
): Promise<ResultadoDeAprobar> {
  await db
    .from('cambios_de_plantilla')
    .update({
      estado,
      resuelto_at: new Date().toISOString(),
      ...(extra.motivo ? { motivo: extra.motivo.slice(0, 500) } : {}),
      ...(extra.nueva ? { nueva_plantilla: extra.nueva } : {}),
    })
    .eq('id', id)
  return estado === 'aprobado' && extra.nueva ? { ok: true, nueva: extra.nueva } : { ok: false, motivo: extra.motivo ?? estado }
}

export async function descartarCambio(db: SupabaseClient, id: string): Promise<void> {
  await cerrar(db, id, 'descartado', {})
}
