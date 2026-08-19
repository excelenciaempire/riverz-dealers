import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'

/**
 * La puerta de Riverz 2.0, en el servidor.
 *
 * Esconder el ítem del menú no alcanza: la URL se puede escribir. Y el gate va
 * acá y no en `SectionGuard` porque ese vive en el cliente y deja ver la
 * pantalla un instante antes de redirigir.
 *
 * A diferencia del resto de los flags, este NO se le abre al equipo de
 * plataforma: lo que se está probando es qué ve un comercio con la experiencia
 * prendida, y verla en uno que la tiene apagada no responde esa pregunta.
 */
export default async function OperacionLayout({
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
