import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
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
    .select(
      'updated_at, saldo_centavos, reservado_centavos, auto_recarga_centavos, auto_umbral_centavos'
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      {},
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  return NextResponse.json(
    // Reservations and automatic-recharge settings can change without touching
    // updated_at. Include their state while exposing only an opaque revision.
    {
      revision: data
        ? createHash('sha256').update(JSON.stringify(data)).digest('hex')
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
