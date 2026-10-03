import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { safeSecretEqual } from '@/lib/auth/cron';
import { DealerError, object, uuid, instant } from '@/lib/dealers/validation';
import { checkDb, dealerFailure } from '@/lib/dealers/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
export async function POST(
  req: Request,
  { params }: { params: Promise<{ workspace: string }> }
) {
  try {
    const workspace = uuid((await params).workspace),
      key = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!/^[a-f0-9]{64}$/.test(key)) throw new DealerError('unauthorized', 401);
    const db = supabaseAdmin(),
      r = await db
        .from('dealer_credentials')
        .select('lead_secret_hash')
        .eq('workspace_id', workspace)
        .maybeSingle();
    checkDb(r.error);
    if (
      !safeSecretEqual(
        createHash('sha256').update(key).digest('hex'),
        r.data?.lead_secret_hash
      )
    )
      throw new DealerError('unauthorized', 401);
    const rate = checkRateLimit(`dealer-lead:${workspace}`, {
      limit: 120,
      windowMs: 60000,
    });
    if (!rate.success) return rateLimitResponse(rate);
    const raw = await req.text();
    if (raw.length > 20000) throw new DealerError('invalid');
    const b = object(JSON.parse(raw));
    for (const [key, max] of Object.entries({
      external_id: 200,
      name: 200,
      source: 200,
      preferences: 2000,
      email: 320,
      phone: 16,
    }))
      if (typeof b[key] !== 'string' || String(b[key]).length > max)
        throw new DealerError('invalid');
    if (
      !String(b.external_id).trim() ||
      !String(b.source).trim() ||
      !/^\+[1-9]\d{7,14}$/.test(String(b.phone)) ||
      typeof b.consent !== 'boolean'
    )
      throw new DealerError('invalid');
    if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email)))
      throw new DealerError('invalid');
    const consent_at = b.consent ? instant(b.consent_at) : null;
    if (consent_at && Date.parse(consent_at) > Date.now() + 60000)
      throw new DealerError('invalid');
    const saved = await db.rpc('dealer_ingest_lead', {
      p_workspace: workspace,
      p_lead: { ...b, consent_at },
    });
    checkDb(saved.error);
    return NextResponse.json(saved.data, {
      status: saved.data?.duplicate ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return dealerFailure(
      e instanceof SyntaxError ? new DealerError('invalid') : e
    );
  }
}
