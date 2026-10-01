import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { syncDriveDocuments } from '@/lib/ai/drive-sync';
async function handler(request: Request) {
  try { assertCronAuth(request, 'AUTOMATION_CRON_SECRET'); }
  catch (error) { if (error instanceof Response) return error; throw error; }
  try { return NextResponse.json(await syncDriveDocuments(supabaseAdmin())); }
  catch { return NextResponse.json({ error: 'drive_sync_unavailable' }, { status: 503 }); }
}
export const GET = withCronRun('drive-documents', handler);
