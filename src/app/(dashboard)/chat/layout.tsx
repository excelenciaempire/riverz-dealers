import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'

/**
 * La puerta del chat, en el servidor.
 *
 * Mismo criterio que /operacion: esconder la pestaña no alcanza porque la URL
 * se puede escribir, y un guard de cliente deja ver la pantalla un instante
 * antes de redirigir. Este flag tampoco se le abre al equipo de plataforma: lo
 * que se prueba es qué ve un comercio con la experiencia prendida.
 */
export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/ingresar')

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) redirect('/panel')

  const flags = await getFeatureFlags(admin, workspaceId)
  if (!isRiverz2(flags)) redirect('/panel')

  return <>{children}</>
}
