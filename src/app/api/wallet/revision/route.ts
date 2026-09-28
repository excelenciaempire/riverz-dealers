import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

export const dynamic = 'force-dynamic';
export async function GET() {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({}, { status: 401 });
  const db = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(db, user.id);
  if (!workspaceId) return NextResponse.json({}, { status: 400 });
  const { data, error } = await db
    .from('wallet_accounts')
    .select('updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      {},
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  return NextResponse.json(
    { revision: data?.updated_at ?? null },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
