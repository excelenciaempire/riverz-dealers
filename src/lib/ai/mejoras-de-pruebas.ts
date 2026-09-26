import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aplicarSolasSiCorresponde,
  encolarParaPlataforma,
  generarPropuestas,
  transcripcionDeFeedbackReal,
} from '@/lib/ai/mejoras';
import {
  limpiarFeedback,
  limpiarItems,
  transcripcionConFeedback,
  type ItemGuardado,
  type Propuestas,
} from '@/lib/ai/sesiones-de-prueba';

/**
 * Las dos fuentes de feedback convertidas en mejoras: una prueba guardada y
 * el feedback que el equipo dejó en la bandeja. Las usan las pantallas (a
 * pedido) y el cron (solas, con "Aplicar mejoras solas").
 */

/** Una prueba con sus marcas → propuestas guardadas en la prueba. */
export async function mejorarSesionDePrueba(
  admin: SupabaseClient,
  workspaceId: string,
  sesionId: string
): Promise<Propuestas | 'no_existe' | 'sin_feedback' | 'fallo'> {
  const { data: fila } = await admin
    .from('ai_test_sessions')
    .select('items, feedback')
    .eq('workspace_id', workspaceId)
    .eq('id', sesionId)
    .maybeSingle();
  if (!fila) return 'no_existe';
  const items = limpiarItems((fila as { items: unknown }).items);
  const feedback = limpiarFeedback((fila as { feedback: unknown }).feedback, items.length);
  if (feedback.length === 0) return 'sin_feedback';

  const generadas = await generarPropuestas(admin, {
    workspaceId,
    transcripcion: transcripcionConFeedback(items, feedback),
    referenciaTipo: 'ai_test_session',
    referenciaId: sesionId,
  });
  if (!generadas) return 'fallo';
  const propuestas = await aplicarSolasSiCorresponde(admin, workspaceId, generadas);
  await encolarParaPlataforma(admin, { workspaceId, origen: 'prueba', origenId: sesionId, propuestas });
  await admin.from('ai_test_sessions').update({ propuestas }).eq('workspace_id', workspaceId).eq('id', sesionId);
  return propuestas;
}

/** El feedback nuevo de la bandeja → un lote de propuestas. */
export async function mejorarFeedbackReal(
  admin: SupabaseClient,
  workspaceId: string,
  opts: { automatico: boolean }
): Promise<{ id: string; propuestas: Propuestas } | 'sin_feedback' | 'fallo'> {
  const { data } = await admin
    .from('ai_feedback')
    .select('id, captura, voto, nota')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'nuevo')
    .order('created_at', { ascending: true })
    .limit(30);
  const filas = (data ?? []) as Array<{ id: string; captura: ItemGuardado[]; voto: 'bien' | 'mal' | null; nota: string }>;
  // Un 👍 sin nota no pide ningún cambio: se marca como usado y no se manda.
  const utiles = filas.filter((f) => f.voto === 'mal' || f.nota.trim());
  const ids = filas.map((f) => f.id);
  if (utiles.length === 0) {
    if (ids.length) await admin.from('ai_feedback').update({ estado: 'usado' }).in('id', ids);
    return 'sin_feedback';
  }
  const generadas = await generarPropuestas(admin, {
    workspaceId,
    transcripcion: transcripcionDeFeedbackReal(utiles),
    referenciaTipo: 'ai_feedback',
    referenciaId: null,
  });
  if (!generadas) return 'fallo';
  const propuestas = await aplicarSolasSiCorresponde(admin, workspaceId, generadas);
  const { data: lote, error } = await admin
    .from('ai_mejoras_lotes')
    .insert({ workspace_id: workspaceId, feedback_ids: ids, propuestas, automatico: opts.automatico })
    .select('id')
    .single();
  if (error || !lote) return 'fallo';
  await admin.from('ai_feedback').update({ estado: 'usado', updated_at: new Date().toISOString() }).in('id', ids);
  await encolarParaPlataforma(admin, {
    workspaceId,
    origen: 'bandeja',
    origenId: (lote as { id: string }).id,
    propuestas,
  });
  return { id: (lote as { id: string }).id, propuestas };
}
