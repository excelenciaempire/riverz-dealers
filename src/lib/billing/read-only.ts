import type { SupabaseClient } from '@supabase/supabase-js';

export const BILLING_READ_ONLY = 'subscription_read_only';

export class BillingReadOnlyError extends Error {
  readonly code = BILLING_READ_ONLY;
  constructor() { super(BILLING_READ_ONLY); this.name = 'BillingReadOnlyError'; }
}

/** The database clock is authoritative, including at the exact grace deadline. */
export async function workspaceReadOnly(db: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data, error } = await db.rpc('workspace_billing_write_allowed', { p_workspace: workspaceId });
  if (error || typeof data !== 'boolean') throw new Error('subscription_payment_state_unavailable');
  return !data;
}

export async function assertWorkspaceWritable(db: SupabaseClient, workspaceId: string) {
  if (await workspaceReadOnly(db, workspaceId)) throw new BillingReadOnlyError();
}

/** Receipt, reconciliation and account recovery remain reachable while business edits stop. */
export function isBusinessMutation(path: string, method: string): boolean {
  if (/^\/api\/(?:admin|cron|internal|auth|csrf|client-errors|legal|widget)(?:\/|$)/.test(path)) return false;
  if (/^\/api\/billing\/(?:estado|checkout|webhook|shopify\/callback|recovery)(?:\/|$)/.test(path)) return false;
  if (/^\/api\/(?:mcp|oauth\/token|oauth\/register|profile\/locale)(?:\/|$)/.test(path)) return false;
  if (/^\/api\/wallet\/(?:recarga|checkout|tarjeta|portal)(?:\/|$)/.test(path)) return false;
  if (/^\/api\/(?:whatsapp\/webhook|channels\/[^/]+\/webhook|(?:shopify|woocommerce|tiendanube)\/webhooks|mercadopago\/webhook|voice\/webhook|meta\/(?:data-deletion|deauthorize))(?:\/|$)/.test(path) || /^\/api\/hooks\//.test(path)) return false;
  if (path === '/api/channels/gmail/push' || path === '/api/integrations/klaviyo/hook') return false;
  if (method === 'POST' && /^\/api\/conversations\/[^/]+\/read$/.test(path)) return false;
  if (/^\/api\/conversations\/[^/]+\/(?:sync|tiktok-refresh)$/.test(path) || path === '/api/messages/recover-media') return false;
  if (method === 'HEAD' || method === 'OPTIONS') return false;
  if (method === 'GET') return /\/(?:oauth\/start|oauth\/callback|callback|install)$/.test(path);
  return path.startsWith('/api/') || method === 'POST'; // Includes server actions.
}
