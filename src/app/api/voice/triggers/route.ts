import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { createClient } from '@/lib/supabase/server';
import { isVoiceMember } from '@/lib/voice/voice-connection-store';

/**
 * Qué puede hacer sonar el teléfono, hoy, en esta cuenta.
 *
 * Es LA pregunta del comercio y no había pantalla que la contestara. Hay cinco
 * puertas que crean una llamada —el nodo del lienzo, `escalate_to_call`, las
 * campañas, el botón de la bandeja y la capa de capacidades— repartidas por
 * tres secciones sin relación visible entre sí. Peor: en el editor del agente
 * hay cuatro interruptores de «objetivo» que parecen decidirlo y no disparan
 * nada; sólo redactan el guion DESPUÉS de que otra puerta creó la llamada.
 *
 * Esto junta las tres que se pueden configurar. Las otras dos no van: el botón
 * de la bandeja es manual (no es una regla) y la capa de capacidades es del
 * Operador, que ya se explica solo.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }
  if (!(await isVoiceMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = supabaseAdmin();
  try {
    // Los pasos «Llamar con IA» traen su automatización colgada: filtrar por
    // el paso y no por la automatización es lo que evita traerse el lienzo
    // entero de cada una para después mirar si alguno llama.
    const [pasos, agentes, campanas] = await Promise.all([
      db
        .from('automation_steps')
        .select(
          'automation_id, step_config, automations!inner(id, name, is_active, deleted_at, workspace_id)',
        )
        .eq('step_type', 'voice_call')
        .eq('automations.workspace_id', workspaceId)
        .is('automations.deleted_at', null),
      db
        .from('ai_agents')
        .select('id, name, voice_agent_id')
        .eq('workspace_id', workspaceId)
        .eq('voice_ai_decides', true)
        .not('voice_agent_id', 'is', null)
        .is('deleted_at', null),
      db
        .from('voice_campaigns')
        .select('id, name, status, agent_id')
        .eq('workspace_id', workspaceId)
        .in('status', ['running', 'paused']),
    ]);

    // Una automatización con dos nodos de llamada aparecía dos veces.
    const porId = new Map<
      string,
      { id: string; name: string; active: boolean; agent_ids: Set<string> }
    >();
    for (const fila of (pasos.data ?? []) as unknown as {
      step_config?: { agent_id?: string };
      automations: { id: string; name: string; is_active: boolean };
    }[]) {
      const a = fila.automations;
      if (!a) continue;
      const current = porId.get(a.id) ?? {
        id: a.id,
        name: a.name,
        active: a.is_active,
        agent_ids: new Set<string>(),
      };
      const agentId = fila.step_config?.agent_id;
      if (agentId) current.agent_ids.add(agentId);
      porId.set(a.id, current);
    }

    return NextResponse.json({
      automations: [...porId.values()].map(({ agent_ids, ...automation }) => ({
        ...automation,
        agent_ids: [...agent_ids],
      })),
      deciding: (agentes.data ?? []) as {
        id: string;
        name: string;
        voice_agent_id: string;
      }[],
      campaigns: (campanas.data ?? []) as {
        id: string;
        name: string;
        status: string;
        agent_id: string;
      }[],
    });
  } catch (err) {
    return serverError(err, 'voice triggers failed');
  }
}
