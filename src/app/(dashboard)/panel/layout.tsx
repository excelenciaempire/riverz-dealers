import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'

/**
 * Con Riverz 2.0 prendido, la casa es el chat.
 *
 * `/panel` es a dónde llega todo el mundo después de iniciar sesión (lo manda
 * el proxy) y a dónde apuntan links viejos. Para un comercio con la experiencia
 * nueva ese panel ya no es su inicio: el estado vive en la pestaña Panel y la
 * aplicación de siempre entra por la bandeja. Sin este rebote, entrar a Riverz
 * seguiría cayendo en la pantalla vieja.
 *
 * Fail-soft: cualquier error resolviendo el flag deja pasar al panel de
 * siempre, que es el destino seguro.
 */
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const admin = supabaseAdmin()
      const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
      if (workspaceId && isRiverz2(await getFeatureFlags(admin, workspaceId))) {
        redirect('/chat')
      }
    }
  } catch (err) {
    // `redirect()` corta con una excepción propia de Next: hay que dejarla pasar.
    if (err && typeof err === 'object' && 'digest' in err) throw err
    console.error('[panel/layout] no se pudo resolver riverz_2:', err)
  }

  return <>{children}</>
}
