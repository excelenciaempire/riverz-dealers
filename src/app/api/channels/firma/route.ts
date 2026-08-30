import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

export const dynamic = 'force-dynamic'

/** Tope del pie. Una firma más larga que esto ya es un correo aparte. */
const MAX = 400

/**
 * PATCH /api/channels/firma  { connection_id, signature }
 *
 * El pie del buzón. Vive en la conexión y no en el workspace porque un comercio
 * puede tener dos —ventas y posventa— y no firman igual.
 *
 * Sólo correo: en los canales de chat el nombre está arriba, en la
 * conversación, y una firma al pie de cada mensaje sería ruido.
 */
export async function PATCH(request: Request): Promise<Response> {
  const block = await csrfGuard(request)
  if (block) return block
  const locale = await getLocale()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    connection_id?: string
    signature?: string
  } | null
  const connectionId = body?.connection_id?.trim()
  if (!connectionId) {
    return NextResponse.json({ error: 'connection_id required' }, { status: 400 })
  }
  const firma = (body?.signature ?? '').trim().slice(0, MAX)

  // La pertenencia se comprueba con la sesión del comercio: la consulta
  // autenticada sólo ve las conexiones de su workspace (RLS). El cliente de
  // servicio se usa después, para escribir el jsonb completo.
  const { data: propia } = await supabase
    .from('channel_connections')
    .select('id, channel')
    .eq('id', connectionId)
    .maybeSingle()
  const canal = (propia as { channel?: string } | null)?.channel
  if (!propia || (canal !== 'gmail' && canal !== 'outlook')) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.connectionNotFound') },
      { status: 404 },
    )
  }

  const admin = supabaseAdmin()
  const { data: fila } = await admin
    .from('channel_connections')
    .select('config')
    .eq('id', connectionId)
    .maybeSingle()
  const cfg = ((fila as { config?: Record<string, unknown> } | null)?.config ??
    {}) as Record<string, unknown>
  const { error } = await admin
    .from('channel_connections')
    .update({ config: { ...cfg, signature: firma } })
    .eq('id', connectionId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, signature: firma })
}
