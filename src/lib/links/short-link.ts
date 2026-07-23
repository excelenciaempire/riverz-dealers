/**
 * Short links: tokens cortos que redirigen al link real de cada cliente.
 * Backing de los botones URL dinámicos de plantillas (ver `dynamic-links.ts`).
 * Solo servidor — usa el cliente service-role y el endpoint público `/r/:token`.
 */

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** ~8 chars url-safe. Suficiente espacio para no colisionar en la práctica. */
function newToken(): string {
  return randomBytes(6).toString('base64url');
}

/**
 * Crea un short link y devuelve su token. Reintenta ante la (improbable)
 * colisión de token; cualquier otro error de inserción se propaga.
 */
export async function createShortLink(
  db: SupabaseClient,
  args: { workspaceId: string; targetUrl: string; contactId?: string | null },
): Promise<string> {
  for (let i = 0; i < 3; i++) {
    const token = newToken();
    const { error } = await db.from('short_links').insert({
      token,
      target_url: args.targetUrl,
      workspace_id: args.workspaceId,
      contact_id: args.contactId ?? null,
    });
    if (!error) return token;
    // 23505 = unique_violation (token repetido) → reintentar con otro token.
    if ((error as { code?: string }).code !== '23505') {
      throw new Error(`short link insert failed: ${error.message}`);
    }
  }
  throw new Error('short link token collision after retries');
}

/** Resuelve un token a su URL destino (o null si no existe). */
export async function resolveShortLink(
  db: SupabaseClient,
  token: string,
): Promise<string | null> {
  const { data } = await db
    .from('short_links')
    .select('target_url')
    .eq('token', token)
    .maybeSingle();
  const url = (data as { target_url?: string } | null)?.target_url;
  return url && url.trim() ? url : null;
}
