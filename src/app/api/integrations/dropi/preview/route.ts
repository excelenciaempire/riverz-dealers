import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { readLogisticsReview } from '@/lib/integrations/logistics-read';
export async function GET(request: Request) {
  const locale = await getLocale();
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: translate(locale, 'logistics.unauthorized') }, { status: 401 });
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceId(db, user.id);
  if (!workspaceId) return NextResponse.json({ error: translate(locale, 'logistics.noOrders') }, { status: 404 });
  try {
    return NextResponse.json(await readLogisticsReview(admin, workspaceId, locale,
      new URL(request.url).searchParams.get('cursor') ?? undefined), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: translate(locale, 'logistics.error') }, { status: 502 });
  }
}
