import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resuelve el workspace del usuario autenticado. Igual que el resto de
 * surfaces (sin selector de workspace todavía), toma la primera membresía.
 * Devuelve null si el usuario no pertenece a ningún workspace.
 */
export async function resolveWorkspaceId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { workspace_id?: string } | null)?.workspace_id ?? null;
}
