import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { getFeatureFlags, isFeatureEnabled } from '@/lib/admin/feature-flags';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

export const dynamic = 'force-dynamic';

/**
 * Gate duro de la funcionalidad "Pedidos". Si el admin la apagó (feature flag
 * `orders`), nadie abre /pedidos por URL — salvo un platform admin. Complementa
 * el escondido del menú + la redirección client-side con un corte en servidor.
 */
export default async function PedidosLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isPlatformAdmin(user?.email)) {
    // Con el workspace: el flag puede tener una excepcion por comercio, y sin
    // pasarlo este corte duro evaluaria el global y contradiria al menu.
    const workspaceId = user
      ? await resolveWorkspaceIdForUser(supabase, user.id)
      : null;
    const flags = await getFeatureFlags(supabaseAdmin(), workspaceId);
    if (!isFeatureEnabled(flags, 'orders')) redirect('/panel');
  }
  return <>{children}</>;
}
