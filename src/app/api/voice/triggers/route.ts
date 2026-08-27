import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { createClient } from '@/lib/supabase/server';
import { listVoiceAgents } from '@/lib/voice/agents';
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
        .select('automation_id, automations!inner(id, name, is_active, deleted_at, workspace_id)')
        .eq('step_type', 'voice_call')
        .eq('automations.workspace_id', workspaceId)
        .is('automations.deleted_at', null),
      listVoiceAgents(db, workspaceId, 'id, name, voice_ai_decides'),
      db
        .from('voice_campaigns')
        .select('id, name, status')
        .eq('workspace_id', workspaceId)
        .in('status', ['running', 'paused']),
    ]);

    // Una automatización con dos nodos de llamada aparecía dos veces.
    const porId = new Map<string, { id: string; name: string; active: boolean }>();
    for (const fila of (pasos.data ?? []) as unknown as {
      automations: { id: string; name: string; is_active: boolean };
    }[]) {
      const a = fila.automations;
      if (a) porId.set(a.id, { id: a.id, name: a.name, active: a.is_active });
    }

    return NextResponse.json({
      automations: [...porId.values()],
      // Sólo los que además tienen permiso de decidir por su cuenta: listar
      // todos los agentes de voz acá haría parecer que cualquiera llama solo.
      deciding: (agentes as unknown as { id: string; name: string; voice_ai_decides?: boolean }[])
        .filter((a) => a.voice_ai_decides)
        .map((a) => ({ id: a.id, name: a.name })),
      campaigns: (campanas.data ?? []) as { id: string; name: string; status: string }[],
    });
  } catch (err) {
    return serverError(err, 'voice triggers failed');
  }
}
