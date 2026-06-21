import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/flows/[id]/versions/[versionId]/restore
 *
 * Restaura el flujo al snapshot de esa versión: reemplaza la fila
 * flows + delete-then-insert de flow_nodes. Después crea
 * automáticamente otra versión "draft" con nota "Restaurado de
 * <fecha>" para que el merchant pueda volver a la versión anterior
 * a la restauración si se arrepiente.
 */

interface RestoreSnapshot {
  flow: {
    name?: string;
    description?: string;
    trigger_type?: string;
    trigger_config?: Record<string, unknown>;
    entry_node_id?: string;
    fallback_policy?: Record<string, unknown>;
    trigger_position_x?: number;
    trigger_position_y?: number;
  };
  nodes: Array<{
    node_key: string;
    node_type: string;
    config: Record<string, unknown>;
    position_x?: number;
    position_y?: number;
  }>;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id, versionId } = await context.params;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validamos que la versión pertenece al flujo (RLS lo cubre, pero
  // chequeamos el id para evitar restaurar uno de otro flow_id).
  const { data: version, error: vErr } = await supabase
    .from('flow_versions')
    .select('id, flow_id, snapshot, created_at')
    .eq('id', versionId)
    .eq('flow_id', id)
    .maybeSingle();
  if (vErr || !version) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.restoreVersionNotFound') },
      { status: 404 },
    );
  }

  const admin = supabaseAdmin();
  const snap = (version as { snapshot: RestoreSnapshot }).snapshot;

  // 1) Snapshot el estado ACTUAL como draft antes de restaurar,
  //    para que el merchant pueda deshacer la restauración.
  const [{ data: curFlow }, { data: curNodes }] = await Promise.all([
    admin.from('flows').select('*').eq('id', id).maybeSingle(),
    admin.from('flow_nodes').select('*').eq('flow_id', id),
  ]);
  if (curFlow) {
    await admin
      .from('flow_versions')
      .delete()
      .eq('flow_id', id)
      .eq('kind', 'draft');
    await admin.from('flow_versions').insert({
      flow_id: id,
      kind: 'draft',
      snapshot: { flow: curFlow, nodes: curNodes ?? [] },
      note: translate(locale, 'errFlows.restoreBackupNote'),
      created_by: user.id,
    });
  }

  // 2) Aplicar el snapshot. Update fila flows + replace nodes.
  const flowPatch = {
    name: snap.flow.name,
    description: snap.flow.description,
    trigger_type: snap.flow.trigger_type,
    trigger_config: snap.flow.trigger_config,
    entry_node_id: snap.flow.entry_node_id,
    fallback_policy: snap.flow.fallback_policy,
    trigger_position_x: snap.flow.trigger_position_x,
    trigger_position_y: snap.flow.trigger_position_y,
    updated_at: new Date().toISOString(),
  };
  const { error: updErr } = await admin
    .from('flows')
    .update(flowPatch)
    .eq('id', id);
  if (updErr) {
    return serverError(updErr);
  }
  const { error: delErr } = await admin
    .from('flow_nodes')
    .delete()
    .eq('flow_id', id);
  if (delErr) {
    return serverError(delErr);
  }
  if (snap.nodes.length > 0) {
    const { error: insErr } = await admin.from('flow_nodes').insert(
      snap.nodes.map((n) => ({
        flow_id: id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
        position_x: n.position_x ?? 0,
        position_y: n.position_y ?? 0,
      })),
    );
    if (insErr) {
      return serverError(insErr);
    }
  }

  return NextResponse.json({ ok: true });
}
