import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const { data: original, error: origErr } = await admin
    .from('automations')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (origErr) return serverError(origErr)
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Autorización por workspace (el admin client bypassa RLS): la copia solo
  // se permite si el usuario es miembro del workspace de la automatización.
  // No alcanza con user_id porque los compañeros de equipo son editores
  // válidos; y filtrar solo por user_id dejaba la copia sin workspace_id.
  const workspaceId = original.workspace_id as string | null
  if (!workspaceId) {
    // Filas legacy pre-013 sin backfill: tratar como no encontrada para no
    // filtrar su existencia.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: copy, error: copyErr } = await admin
    .from('automations')
    .insert({
      user_id: user.id,
      workspace_id: workspaceId,
      name: `${original.name} (Copy)`,
      description: original.description,
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
      is_active: false,
    })
    .select()
    .single()
  if (copyErr || !copy) {
    return serverError(copyErr ?? new Error('copy failed'))
  }

  const { data: steps } = await admin
    .from('automation_steps')
    .select('id, parent_step_id, branch, step_type, step_config, position')
    .eq('automation_id', id)
    .order('position', { ascending: true })

  if (steps && steps.length > 0) {
    // Re-map parent_step_id: build old→new id map first so the second
    // pass inserts rows with correct parent references.
    const idMap = new Map<string, string>()
    const uid = () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    for (const row of steps) idMap.set(row.id as string, uid())

    const rows = steps.map((row) => ({
      id: idMap.get(row.id as string)!,
      automation_id: copy.id,
      parent_step_id: row.parent_step_id ? idMap.get(row.parent_step_id as string) : null,
      branch: row.branch,
      step_type: row.step_type,
      step_config: row.step_config,
      position: row.position,
    }))
    const { error: insErr } = await admin.from('automation_steps').insert(rows)
    if (insErr) return serverError(insErr)
  }

  return NextResponse.json({ automation: copy }, { status: 201 })
}
