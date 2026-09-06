import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { voiceReadiness } from '@/lib/voice/readiness';
import { isVoiceMember } from '@/lib/voice/voice-connection-store';

/**
 * ¿Puede llamar esta cuenta (o este agente)?
 *
 * GET ?workspace_id=&agent_id=
 *   → { ready, blockers[], warnings[], phone_number, agents[], first_call_done }
 *
 * Lo consume la tarjeta «Llamar con IA» del lienzo, la pantalla de Llamadas,
 * la de campañas, la pestaña de voz del agente y el botón de la bandeja, para
 * que los cinco digan lo mismo. `agents` viaja para que ninguna de ellas
 * vuelva a consultar por su cuenta quién puede atender — de esas copias
 * sueltas salió que la pantalla dijera «listo» con el agente borrado.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  const agentId = url.searchParams.get('agent_id');
  if (!workspaceId) {
    return NextResponse.json(
      { error: 'workspace_id required' },
      { status: 400 }
    );
  }
  if (!(await isVoiceMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const readiness = await voiceReadiness(supabaseAdmin(), workspaceId, agentId);
  return NextResponse.json({
    ready: readiness.ready,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    phone_number: readiness.phoneNumber,
    agents: readiness.agents,
    first_call_done: readiness.firstCallDone,
    outbound: readiness.directions.outbound,
    inbound: readiness.directions.inbound,
    wallet: {
      balance_cents: readiness.wallet.balanceCents,
      reason: readiness.wallet.reason,
    },
    capacity: {
      available_inbound_agents: readiness.capacity.availableInboundAgents,
    },
  });
}
