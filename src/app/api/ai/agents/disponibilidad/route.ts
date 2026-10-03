import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * GET /api/ai/agents/disponibilidad
 *
 * Qué de lo que el agente puede hacer tiene con qué hacerse HOY en esta cuenta.
 *
 * La pizarra de herramientas deja prender todo, incluso lo que todavía no tiene
 * infraestructura: apagar algo de antemano, o dejarlo listo para cuando se
 * conecte la tienda, son las dos cosas razonables. Lo que no puede pasar es que
 * un interruptor quede prendido, no haga nada, y no diga por qué — eso es peor
 * que tenerlo apagado, porque el comercio cree que su agente cobra y no cobra.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { data: miembro } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!miembro) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const admin = supabaseAdmin();
  const voice = await admin.from('channel_connections').select('id')
    .eq('workspace_id', workspaceId).eq('channel', 'voice').eq('status', 'connected')
    .limit(1).maybeSingle();
  return NextResponse.json({ tienda: false, shopify: false, cobro: false, descuento: false, voz: Boolean(voice.data) });
}
