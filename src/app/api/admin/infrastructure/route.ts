import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serverError } from '@/lib/api/errors';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { getInfrastructureStatus } from '@/lib/admin/infrastructure';

/**
 * GET /api/admin/infrastructure — PLATFORM ADMIN ONLY.
 * Estado + saldo en vivo de todo lo conectado (LLMs, voz/telefonía, infra).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isPlatformAdmin(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const data = await getInfrastructureStatus();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return serverError(err, 'infrastructure status failed');
  }
}
