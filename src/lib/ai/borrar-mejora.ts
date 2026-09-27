import type { SupabaseClient } from '@supabase/supabase-js';
import type { Propuestas } from './sesiones-de-prueba';

export const BORRADOS = {
  'borrar-prueba': 'ai_test_sessions',
  'borrar-pruebas': 'ai_test_sessions',
  'borrar-feedback': 'ai_feedback',
  'borrar-lote': 'ai_mejoras_lotes',
  'borrar-cambio': 'cambios_de_plantilla',
  'borrar-plataforma': 'mejoras_plataforma',
} as const;
export type BorradoMejora = keyof typeof BORRADOS;

/** Fail closed: a missing/deleted input or a read error invalidates the batch. */
export async function feedbackVigente(db: SupabaseClient, workspaceId: string, ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const { data, error } = await db.from('ai_feedback').select('id').eq('workspace_id', workspaceId)
    .in('id', ids).neq('estado', 'descartado');
  return !error && new Set((data ?? []).map((r: { id: string }) => r.id)).size === new Set(ids).size;
}

export async function loteVigente(db: SupabaseClient, workspaceId: string, id: string): Promise<boolean> {
  const { data, error } = await db.from('ai_mejoras_lotes').select('feedback_ids, propuestas')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  return !error && !!data?.propuestas && await feedbackVigente(db, workspaceId, data.feedback_ids ?? []);
}

/** Deletes evaluation records, never inbox messages, live rules or Meta templates.
 * Invalidate the source first; retries can finish cleanup after a partial failure.
 * Every operation is workspace-scoped and every error prevents a success receipt.
 */
export async function borrarMejora(db: SupabaseClient, workspaceId: string, que: BorradoMejora, id: string) {
  const tabla = BORRADOS[que];
  const bulk = que === 'borrar-pruebas';
  const check = (result: { error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
  };
  const scope = () => db.from(tabla).delete({ count: 'exact' }).eq('workspace_id', workspaceId);
  const queue = (origen: string) => db.from('mejoras_plataforma').delete().eq('workspace_id', workspaceId).eq('origen', origen);

  if (tabla === 'ai_test_sessions') {
    const invalidate = db.from(tabla).update({ feedback: [], propuestas: null }).eq('workspace_id', workspaceId);
    check(await (bulk ? invalidate : invalidate.eq('id', id)));
    check(await (bulk ? queue('prueba') : queue('prueba').eq('origen_id', id)));
  } else if (tabla === 'ai_feedback') {
    check(await db.from(tabla).update({ estado: 'descartado', captura: [], nota: '', voto: null })
      .eq('workspace_id', workspaceId).eq('id', id));
    // A batch mixes inputs: invalidate the whole batch rather than retain guesses
    // about which rule came from the deleted conversation.
    const batches = await db.from('ai_mejoras_lotes').select('id').eq('workspace_id', workspaceId).overlaps('feedback_ids', [id]);
    check(batches);
    for (const batch of batches.data ?? []) {
      await borrarMejora(db, workspaceId, 'borrar-lote', batch.id);
    }
  } else if (tabla === 'ai_mejoras_lotes') {
    check(await db.from(tabla).update({ propuestas: null }).eq('workspace_id', workspaceId).eq('id', id));
    check(await queue('bandeja').eq('origen_id', id));
  } else if (tabla === 'mejoras_plataforma') {
    const row = await db.from(tabla).select('origen, origen_id, problema, prompt').eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
    check(row);
    if (row.data?.origen_id) {
      const sourceTable = row.data.origen === 'prueba' ? 'ai_test_sessions' : 'ai_mejoras_lotes';
      const source = await db.from(sourceTable).select('propuestas').eq('workspace_id', workspaceId).eq('id', row.data.origen_id).maybeSingle();
      check(source);
      const propuestas = source.data?.propuestas as Propuestas | null;
      if (propuestas) {
        check(await db.from(sourceTable).update({ propuestas: {
          ...propuestas,
          plataforma: propuestas.plataforma.filter(p => p.problema !== row.data!.problema || p.prompt !== row.data!.prompt),
        } }).eq('workspace_id', workspaceId).eq('id', row.data.origen_id));
      }
    }
  }
  const deleted = await (bulk ? scope() : scope().eq('id', id));
  check(deleted);
  if (deleted.count === null) throw new Error('unconfirmed_deletion');
  return { deleted: deleted.count };
}
