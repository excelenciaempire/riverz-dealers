import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { resolverWabaYToken } from '@/lib/templates/create'
import { deleteMessageTemplate } from '@/lib/whatsapp/meta-api'
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

  // Un borrador no existe fuera de esta cuenta: no hay a quién pedirle nada.
  const estaEnMeta = Boolean(plantilla.meta_template_id) || plantilla.status !== 'Draft'

  if (estaEnMeta) {
    const { wabaId, accessToken } = await resolverWabaYToken(supabase, workspaceId, user.id)
    if (!wabaId || !accessToken) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.whatsappNotConnected') },
        { status: 400 },
      )
    }

    try {
      await deleteMessageTemplate({
        wabaId,
        accessToken,
        name: plantilla.name,
        // Con el id se borra SÓLO este idioma. Sin él, Meta se lleva todas las
        // versiones del nombre — que es lo correcto cuando no sabemos cuál es
        // cuál, y es lo único que se puede pedir.
        hsmId: plantilla.meta_template_id ?? undefined,
      })
    } catch (err) {
      const motivo = err instanceof Error ? err.message : ''
      // Que Meta no la encuentre es el final que se buscaba: la fila local
      // quedó huérfana de una plantilla que ya no está, y dejarla sería
      // condenar a la persona a apretar la papelera para siempre.
      if (!pareceQueYaNoEsta(motivo)) {
        return NextResponse.json(
          { error: motivo || translate(locale, 'errWhatsapp.templateDeleteFailed') },
          { status: 502 },
        )
      }
    }
  }

  const { error } = await supabase
    .from('message_templates')
    .delete()
    .eq('id', plantilla.id)
    .eq('workspace_id', workspaceId)

  if (error) {
    return NextResponse.json(
      { error: translate(locale, 'errWhatsapp.templateDeleteFailed') },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, enMeta: estaEnMeta })
}

/**
 * ¿Meta está diciendo que esa plantilla ya no existe?
 *
 * No hay un código propio: contesta el 100 genérico de «objeto inexistente»
 * con el texto adentro, así que se mira el texto. Un falso positivo acá sólo
 * borra una fila local que igual iba a borrarse.
 */
function pareceQueYaNoEsta(motivo: string): boolean {
  const m = motivo.toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('no existe') ||
    m.includes('not found') ||
    m.includes('unsupported get request') ||
    m.includes('cannot be found')
  )
}
