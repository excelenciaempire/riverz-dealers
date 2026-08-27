import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * GET /api/webchat/knowledge — con qué contesta el agente.
 *
 * El chat no responde con lo que sabe un modelo: responde con lo que el
 * comercio cargó producto por producto (`training_material`). Un producto sin
 * ficha se contesta con su título y su precio, que es como no contestar.
 *
 * Ese hueco no se veía en ninguna pantalla. El comercio miraba el chat, lo veía
 * andar, y no tenía forma de saber que la mitad de su catálogo estaba mudo — se
 * enteraba por una respuesta pobre a un cliente real.
 *
 * Cuenta sobre productos PRINCIPALES (`master_id is null`): una publicación que
 * cuelga de otra hereda su conocimiento, así que contarla como "vacía" inflaría
 * el problema y mandaría al comercio a llenar una ficha que no se usa.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 404 });

  const { data } = await admin
    .from('shopify_products')
    .select('id, title, training_material')
    .eq('workspace_id', workspaceId)
    .is('master_id', null)
    .limit(2000);

  const filas = (data ?? []) as Array<{
    id: string;
    title: string | null;
    training_material: string | null;
  }>;
  const vacios = filas.filter((p) => !p.training_material?.trim());

  return NextResponse.json({
    total: filas.length,
    con_ficha: filas.length - vacios.length,
    sin_ficha: vacios.length,
    // Los primeros nombres, para que el aviso sea concreto y no un número.
    ejemplos: vacios.slice(0, 3).map((p) => (p.title ?? '').trim()).filter(Boolean),
  });
}
