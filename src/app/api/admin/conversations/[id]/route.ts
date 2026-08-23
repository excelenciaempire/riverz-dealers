import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { adminGet } from '@/lib/admin/route';
import { mensajesConPermiso, permisoDeSoporte } from '@/lib/admin/support-access';

/**
 * Una conversación, leída con el permiso del comercio.
 *
 * La barrera del panel sigue en pie para todo lo demás: esto NO pasa por el
 * helper genérico de lectura, va por su propia función, que comprueba el permiso
 * antes de tocar los mensajes. Un permiso que aflojara la regla general
 * convertiría la excepción en la regla el día que alguien copie una consulta.
 *
 * Sin permiso devuelve 403 con el motivo, no una lista vacía: una lista vacía se
 * lee como «no hay mensajes».
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return adminGet(
    request,
    { action: 'view.conversation_content', targetType: 'conversation', targetId: id },
    async () => {
      const { data } = await supabaseAdmin()
        .from('conversations')
        .select('workspace_id, channel, status')
        .eq('id', id)
        .maybeSingle();
      const conv = data as {
        workspace_id: string;
        channel: string;
        status: string | null;
      } | null;
      if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 });

      const permiso = await permisoDeSoporte(conv.workspace_id);
      if (!permiso.vigente) {
        return NextResponse.json(
          { error: 'sin_permiso', permiso },
          { status: 403 },
        );
      }

      return {
        canal: conv.channel,
        estado: conv.status,
        permiso,
        mensajes: await mensajesConPermiso(conv.workspace_id, id),
      };
    },
  );
}
