import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resuelve el workspace del usuario autenticado. Igual que el resto de
 * surfaces (sin selector de workspace todavía), toma la primera membresía —
 * pero IGNORANDO los workspaces borrados.
 *
 * Sin ese filtro, una cuenta cuyo workspace más antiguo fue eliminado (caso
 * real: el inicial se borra al migrar al definitivo) resolvía al workspace
 * muerto: la UI mostraba el bueno —useWorkspace sí descarta los borrados—
 * mientras las campañas, los ajustes y la audiencia se guardaban y buscaban en
 * el otro. El agente no encontraba a nadie y nunca podía enviar.
 *
 * Devuelve null si el usuario no pertenece a ningún workspace vivo.
 */
export async function resolveWorkspaceId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('workspace_members')
    .select('workspace_id, workspaces!inner(deleted_at)')
    .eq('user_id', userId)
    .is('workspaces.deleted_at', null)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { workspace_id?: string } | null)?.workspace_id ?? null;
}
