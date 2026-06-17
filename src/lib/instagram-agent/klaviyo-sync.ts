/**
 * Sync de leads capturados a Klaviyo (owned audience).
 *
 * Cuando el agente captura un email/teléfono en la conversación, lo empujamos
 * a Klaviyo para construir la audiencia propia de la marca (lo que Blueberry
 * vende como "first-party data capture"). Best-effort y desactivado por
 * defecto: si el workspace no tiene Klaviyo conectado, es un no-op silencioso.
 *
 * La credencial se resuelve por workspace (tabla workspace_integrations,
 * encriptada) con `resolveKlaviyoKey`; hay fallback a `KLAVIYO_API_KEY` (env)
 * para despliegues mono-tenant.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

const KLAVIYO_API = 'https://a.klaviyo.com/api/profiles/';
const KLAVIYO_REVISION = '2024-10-15';

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
  const { data } = await db
    .from('workspace_integrations')
    .select('api_key_encrypted, is_active')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'klaviyo')
    .maybeSingle();
  const row = data as { api_key_encrypted: string; is_active: boolean } | null;
  if (row?.is_active && row.api_key_encrypted) {
    try {
      return decrypt(row.api_key_encrypted);
    } catch {
      /* clave corrupta: cae al fallback de env */
    }
  }
  return process.env.KLAVIYO_API_KEY ?? null;
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
    const res = await fetch(KLAVIYO_API, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: KLAVIYO_REVISION,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ data: { type: 'profile', attributes } }),
    });
    // 409 = el perfil ya existe (duplicado): lo tratamos como éxito.
    if (res.ok || res.status === 409) return { synced: true };
    return { synced: false, reason: 'error' };
  } catch {
    return { synced: false, reason: 'error' };
  }
}
