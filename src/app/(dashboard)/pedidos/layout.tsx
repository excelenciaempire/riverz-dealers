import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { getFeatureFlags, isFeatureEnabled } from '@/lib/admin/feature-flags';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';

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
    const flags = await getFeatureFlags(supabaseAdmin());
    if (!isFeatureEnabled(flags, 'orders')) redirect('/panel');
  }
  return <>{children}</>;
}
