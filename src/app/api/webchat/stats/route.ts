import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { readWebchatStats } from '@/lib/dashboard/webchat-query';
import { DashboardAccessError } from '@/lib/dashboard/access';
import { dashboardHeaders } from '@/lib/dashboard/http';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const locale = await getLocale();
  const failure = (key: string, status: number) => NextResponse.json({ error: translate(locale, `dashboard.${key}`) }, { status, headers: dashboardHeaders });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure('outcomeUnauthorized', 401);
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return failure('outcomeUnauthorized', 401);
  try {
    return NextResponse.json(await readWebchatStats(admin, workspaceId, user.id, new Date()), { headers: dashboardHeaders });
  } catch (error) {
    return failure(error instanceof DashboardAccessError ? 'outcomeForbidden' : 'outcomeLoadFailed', error instanceof DashboardAccessError ? 403 : 503);
  }
}
