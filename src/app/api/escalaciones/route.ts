import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * Los casos que el asistente dejó en manos de una persona.
 *
 * Existían desde siempre en la base y no se veían en ningún lado: el hilo
 * quedaba marcado dentro de la bandeja, mezclado entre todos los demás. Para
 * saber cuántas veces el asistente se plantó, por qué, y si alguien lo
 * atendió, había que ir hilo por hilo.
 *
 * Sin agrupar, al revés que los huecos: dos personas con un envío mal enviado
 * son DOS casos con dos clientes esperando, no uno.
 */
export const dynamic = 'force-dynamic';

interface Fila {
  id: string;
  channel: string | null;
  needs_human_reason: string | null;
  needs_human_at: string;
  needs_human_visto_at: string | null;
  needs_human_summary: string | null;
  last_message_text: string | null;
  contacts: { name: string | null } | { name: string | null }[] | null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ casos: [] });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return NextResponse.json({ casos: [] });

  const { data, error } = await admin
    .from('conversations')
    .select(
      'id, channel, needs_human_reason, needs_human_at, needs_human_visto_at, needs_human_summary, last_message_text, contacts(name)',
    )
    .eq('workspace_id', workspaceId)
    .not('needs_human_at', 'is', null)
    .is('deleted_at', null)
    .order('needs_human_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ casos: [] });

  const casos = ((data ?? []) as unknown as Fila[]).map((c) => {
    const contacto = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
    return {
      id: c.id,
      canal: c.channel,
      motivo: c.needs_human_reason,
      cuando: c.needs_human_at,
      // Un caso que nadie abrió todavía es lo único accionable de la lista.
      pendiente: !c.needs_human_visto_at,
      cliente: contacto?.name ?? null,
      resumen: c.needs_human_summary ?? c.last_message_text ?? null,
    };
  });
  return NextResponse.json({ casos });
}
