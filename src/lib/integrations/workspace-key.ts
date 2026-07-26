import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * Credenciales de terceros que el COMERCIO conecta desde Integraciones
 * (`workspace_integrations`, una fila por workspace + proveedor, encriptada).
 *
 * Antes cada proveedor resolvía su key a mano: Klaviyo leía la tabla y Apify
 * solo miraba una variable de entorno del servidor — es decir, en un despliegue
 * multi-tenant nadie podía conectar su propio scraper. Este helper unifica
 * ambos casos: primero lo que el comercio conectó, y solo si no hay nada, la
 * variable de entorno (útil en despliegues de un solo negocio).
 */
export async function resolveWorkspaceKey(
  db: SupabaseClient,
  workspaceId: string | null,
  provider: string,
  envFallback?: string | null,
): Promise<string | null> {
  if (workspaceId) {
    const { data } = await db
      .from('workspace_integrations')
      .select('api_key_encrypted, is_active')
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .maybeSingle();
    const row = data as { api_key_encrypted: string; is_active: boolean } | null;
    if (row?.is_active && row.api_key_encrypted) {
      try {
        const key = decrypt(row.api_key_encrypted);
        if (key) return key;
      } catch {
        /* clave corrupta → cae al fallback */
      }
    }
  }
  return envFallback || null;
}
