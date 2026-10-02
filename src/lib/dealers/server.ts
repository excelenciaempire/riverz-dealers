import 'server-only';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { DealerError } from './validation';
import type { SupabaseClient } from '@supabase/supabase-js';
export async function dealerContext() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new DealerError('unauthorized', 401);
  const workspaceId = await resolveWorkspaceIdForUser(db, user.id);
  if (!workspaceId) throw new DealerError('workspace', 403);
  return { db, workspaceId, userId: user.id };
}
export function checkDb(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const match = error.message?.match(
    /dealer_(unavailable|conflict|reference|closed|past)/
  );
  if (match) throw new DealerError(match[1], 409);
  if (error.code === '23505') throw new DealerError('duplicate', 409);
  if (error.code === 'PGRST116') throw new DealerError('reference', 404);
  if (['42P01', 'PGRST205', 'PGRST202', '42883'].includes(error.code ?? ''))
    throw new DealerError('schema', 503);
  console.error('[dealers]', error.code, error.message);
  throw new DealerError('failed', 500);
}
export async function dealerFailure(error: unknown) {
  const e =
    error instanceof DealerError ? error : new DealerError('failed', 500);
  if (!(error instanceof DealerError)) console.error('[dealers]', error);
  return NextResponse.json(
    {
      error: translate(await getLocale(), `dealers.err_${e.code}`),
      code: e.code,
    },
    { status: e.status }
  );
}
export async function readDealerData(
  db: SupabaseClient,
  workspaceId: string,
  sellerId: string,
  contactId?: string
) {
  async function rows(table: string, columns = '*') {
    const result: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      let q = db
        .from(table)
        .select(columns)
        .eq('workspace_id', workspaceId)
        .order(table === 'dealer_interests' ? 'opportunity_id' : 'id');
      if (table === 'dealer_interests') q = q.order('vehicle_id');
      if (contactId && table === 'dealer_opportunities')
        q = q.eq('contact_id', contactId);
      if (contactId && table === 'contacts') q = q.eq('id', contactId);
      const { data, error } = await q.range(offset, offset + 999);
      checkDb(error);
      result.push(...((data as unknown as Record<string, unknown>[]) ?? []));
      if (!data || data.length < 1000) return result;
    }
  }
  const [
    vehicles,
    opportunities,
    appointments,
    interests,
    contacts,
    workspace,
  ] = await Promise.all([
    rows('dealer_vehicles'),
    rows('dealer_opportunities'),
    rows('dealer_appointments'),
    rows('dealer_interests', 'opportunity_id,vehicle_id,workspace_id'),
    rows('contacts', 'id,name,phone,opted_out'),
    db.from('workspaces').select('timezone').eq('id', workspaceId).single(),
  ]);
  checkDb(workspace.error);
  return {
    vehicles,
    opportunities,
    appointments,
    interests,
    contacts,
    timezone: workspace.data?.timezone || 'UTC',
    seller_id: sellerId,
  };
}
