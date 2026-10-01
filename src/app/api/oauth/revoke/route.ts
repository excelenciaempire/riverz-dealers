import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { hashToken } from '@/lib/mcp/tokens';
import { revocarRefreshDeCliente } from '@/lib/mcp/oauth';
import { clientIp, limitByKey, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const rate = await limitByKey(`oauth-revoke:${clientIp(request)}`, { limit: 60, windowMs: 60_000 });
  if (!rate.success) return rateLimitResponse(rate);
  const body = new URLSearchParams(await request.text());
  const token = body.get('token'); const clientId = body.get('client_id');
  if (!token || !clientId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  try {
    const db = supabaseAdmin();
    const hash = hashToken(token);
    const { data: refresh, error } = await db.from('oauth_refresh_tokens').select('workspace_id, user_id')
      .eq('token_hash', hash).eq('client_id', clientId).maybeSingle();
    if (error) throw new Error('query_failed');
    let identity = refresh;
    if (!identity) {
      const { data, error: accessError } = await db.from('mcp_tokens').select('workspace_id, created_by')
        .eq('token_hash', hash).eq('client_id', clientId).eq('origin', 'oauth').maybeSingle();
      if (accessError) throw new Error('query_failed');
      if (data?.created_by) identity = { workspace_id: data.workspace_id, user_id: data.created_by };
    }
    if (identity) await revocarRefreshDeCliente(db, { clientId, workspaceId: identity.workspace_id, userId: identity.user_id });
    // RFC 7009: unknown tokens receive the same success response.
    return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503 }); }
}
