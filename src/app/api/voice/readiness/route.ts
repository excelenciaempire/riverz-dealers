import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { voiceReadiness } from '@/lib/voice/readiness';
import { isVoiceMember } from '@/lib/voice/voice-connection-store';

/**
 * ¿Puede llamar esta cuenta (o este agente)?
 *
 * GET ?workspace_id=&agent_id= → { ready, blockers[], phone_number }
 *
 * Lo consume la tarjeta «Llamar con IA» del lienzo, la pantalla de Voz y el
 * botón de llamar de la bandeja, para que los tres digan lo mismo.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  const agentId = url.searchParams.get('agent_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }
  if (!(await isVoiceMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const readiness = await voiceReadiness(supabaseAdmin(), workspaceId, agentId);
  return NextResponse.json({
    ready: readiness.ready,
    blockers: readiness.blockers,
    phone_number: readiness.phoneNumber,
  });
}
