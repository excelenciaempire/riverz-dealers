import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * Qué pasarelas de pago tiene conectadas este comercio.
 *
 * La galería de automatizaciones lo usa para no ofrecer recetas que no
 * podrían funcionar: la de pagos rechazados necesita una pasarela, y sin
 * ella se activaría sin dispararse nunca.
 *
 * El descubrimiento NO depende de esconder o mostrar la receta: Mercado
 * Pago es un conector visible en Integraciones, junto a las tiendas. El
 * camino es conectar y ahí aparece la receta, no encontrar la receta para
 * enterarse de que existe la conexión.
 *
 * Cuando entre otra pasarela se suma acá y las recetas que la declaren se
 * abren solas, sin tocar la galería.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) {
    // Sin workspace se devuelve el caso conservador (nada conectado) en vez
    // de un error que rompa la galería entera.
    return NextResponse.json({ payments: { mercadopago: false } });
  }

  const admin = supabaseAdmin();
  const { data } = await admin
    .from('workspace_integrations')
    .select('provider, is_active')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  const active = new Set(
    ((data ?? []) as { provider: string }[]).map((r) => r.provider),
  );

  return NextResponse.json({
    payments: { mercadopago: active.has('mercadopago') },
  });
}
