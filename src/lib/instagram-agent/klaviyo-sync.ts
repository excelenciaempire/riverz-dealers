/**
 * Empuje inmediato a Klaviyo del lead que captura el agente de Instagram.
 *
 * Es el atajo del caso caliente: la persona acaba de dejar su correo en la
 * conversación y el comercio quiere poder escribirle ya, sin esperar al
 * siguiente barrido. El espejo completo de la base (todos los canales, con
 * etiquetas y bajas) lo hace el cron `klaviyo-sync` sobre
 * `@/lib/integrations/klaviyo`; acá sólo va el perfil suelto.
 *
 * Best-effort y apagado por defecto: si el workspace no tiene Klaviyo
 * conectado, no hace nada.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { klaviyoFetch } from '@/lib/integrations/klaviyo';
import { resolveWorkspaceKey } from '@/lib/integrations/workspace-key';

export interface LeadSyncInput {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

export type LeadSyncResult =
  | { synced: true }
  | { synced: false; reason: 'not_configured' | 'no_identifier' | 'error' };

/** Resuelve la API key de Klaviyo del workspace (o env como fallback). */
export async function resolveKlaviyoKey(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  return resolveWorkspaceKey(db, workspaceId, 'klaviyo', process.env.KLAVIYO_API_KEY);
}

export async function syncLeadToKlaviyo(
  input: LeadSyncInput,
  apiKey: string | null | undefined,
): Promise<LeadSyncResult> {
  if (!apiKey) return { synced: false, reason: 'not_configured' };
  if (!input.email && !input.phone) {
    return { synced: false, reason: 'no_identifier' };
  }

  const attributes: Record<string, unknown> = {};
  if (input.email) attributes.email = input.email;
  if (input.phone) attributes.phone_number = input.phone;
  if (input.name) {
    const [first, ...rest] = input.name.trim().split(/\s+/);
    attributes.first_name = first;
    if (rest.length) attributes.last_name = rest.join(' ');
  }

  try {
    const res = await klaviyoFetch(apiKey, '/profiles/', {
      method: 'POST',
      body: JSON.stringify({ data: { type: 'profile', attributes } }),
    });
    // 409 = el perfil ya existe (duplicado): lo tratamos como éxito.
    if (res.ok || res.status === 409) return { synced: true };
    return { synced: false, reason: 'error' };
  } catch {
    return { synced: false, reason: 'error' };
  }
}
