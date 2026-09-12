import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getFeatureFlags } from '@/lib/admin/feature-flags';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';

export const dynamic = 'force-dynamic';

/** Refresh only the signed-in workspace; never accept a workspace from the caller. */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers });
  }
  try {
    const db = supabaseAdmin();
    const workspaceId = await resolveWorkspaceIdForUser(db, user.id);
    if (!workspaceId) {
      return NextResponse.json({ error: 'no_workspace' }, { status: 404, headers });
    }
    const flags = await getFeatureFlags(db, workspaceId, { strict: true });
    return NextResponse.json({ flags, isPlatformAdmin: isPlatformAdmin(user.email) }, { headers });
  } catch {
    // Keep the last known client settings rather than replacing a failed read with defaults.
    return NextResponse.json({ error: 'feature_flags_unavailable' }, { status: 503, headers });
  }
}
