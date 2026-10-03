import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkDb } from './server';
import { dealerSettings } from './settings';
import { DealerError } from './validation';

export async function readDealerSettings(
  db: SupabaseClient,
  workspace: string
) {
  const r = await db
    .from('dealer_settings')
    .select('settings,version')
    .eq('workspace_id', workspace)
    .maybeSingle();
  checkDb(r.error);
  return {
    settings: dealerSettings(r.data?.settings ?? {}),
    version: r.data?.version ?? 0,
  };
}
export async function assertDealerManager(
  db: SupabaseClient,
  workspace: string,
  user: string
) {
  const r = await db
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace)
    .eq('user_id', user)
    .maybeSingle();
  checkDb(r.error);
  if (r.data?.role !== 'admin') {
    const w = await db
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspace)
      .single();
    checkDb(w.error);
    if (w.data?.owner_id !== user) throw new DealerError('workspace', 403);
  }
}
