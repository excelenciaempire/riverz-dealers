import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { borrarPlantilla } from '@/lib/templates/borrar'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * Borrar una plantilla — también de Meta.
 *
 * La papelera de la lista hacía un `delete` contra Supabase desde el navegador
 * y nada más. En Meta la plantilla seguía existiendo, así que el siguiente
 * «Sincronizar» la traía de vuelta: el botón parecía funcionar y la fila
 * reaparecía sola. Peor todavía, quien intentaba escribir una nueva con ese
 * nombre chocaba con «There is already Spanish content for this template»
 * sobre algo que creía borrado.
 *
 * El orden importa: **primero Meta, después la fila**. Al revés, un fallo de
 * Meta deja la plantilla viva allá y muerta acá, que es de donde venimos. Si
 * Meta falla, la fila se queda y se dice por qué.
 *
 * La excepción es la plantilla que nunca llegó a Meta (un borrador): ahí no hay
 * nada que borrar del otro lado.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block

  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errWhatsapp.notAuthenticated') },
      { status: 401 },
    )
  }

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 400 })
  }

  const { id } = await params
  const { data: fila } = await supabase
    .from('message_templates')
    .select('id, name, language, status, meta_template_id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!fila) {
    return NextResponse.json(
      { error: translate(locale, 'errWhatsapp.templateNotFound') },
      { status: 404 },
    )
  }

  const plantilla = fila as {
    id: string
    name: string
    language: string | null
    status: string | null
    meta_template_id: string | null
  }

  const r = await borrarPlantilla(supabase, { workspaceId, userId: user.id, plantilla })
  if (!r.ok) {
    if (r.motivo === 'sin_whatsapp') {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.whatsappNotConnected') },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: r.detalle || translate(locale, 'errWhatsapp.templateDeleteFailed') },
      { status: r.motivo === 'meta' ? 502 : 500 },
    )
  }
  return NextResponse.json({ ok: true, enMeta: r.enMeta })
}
