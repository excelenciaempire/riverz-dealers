import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { csrfGuard } from '@/lib/csrf';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { dealerContext, dealerFailure, checkDb } from '@/lib/dealers/server';
import {
  assertDealerManager,
  readDealerSettings,
} from '@/lib/dealers/settings-server';
import { dealerSettings } from '@/lib/dealers/settings';
import { DealerError, object } from '@/lib/dealers/validation';

export async function GET() {
  try {
    const c = await dealerContext();
    const config = await readDealerSettings(c.db, c.workspaceId);
    const [runs, team] = await Promise.all([
      c.db
        .from('dealer_sync_runs')
        .select('*')
        .eq('workspace_id', c.workspaceId)
        .order('started_at', { ascending: false })
        .limit(10),
      c.db
        .from('workspace_members')
        .select('user_id,role')
        .eq('workspace_id', c.workspaceId),
    ]);
    checkDb(runs.error);
    checkDb(team.error);
    let can_manage = true;
    try {
      await assertDealerManager(c.db, c.workspaceId, c.userId);
    } catch {
      can_manage = false;
    }
    const credentials = can_manage
      ? await supabaseAdmin()
          .from('dealer_credentials')
          .select('lead_secret_hash,inventory_token_encrypted')
          .eq('workspace_id', c.workspaceId)
          .maybeSingle()
      : { data: null, error: null };
    checkDb(credentials.error);
    const ids = (team.data ?? []).map((member) => member.user_id);
    const profiles = ids.length
      ? await c.db
          .from('profiles')
          .select('user_id,full_name,email')
          .in('user_id', ids)
      : { data: [], error: null };
    checkDb(profiles.error);
    return NextResponse.json(
      {
        ...config,
        can_manage,
        team: (team.data ?? []).map((member) => ({
          ...member,
          name:
            profiles.data?.find((p) => p.user_id === member.user_id)
              ?.full_name ||
            profiles.data?.find((p) => p.user_id === member.user_id)?.email ||
            member.user_id,
        })),
        runs: runs.data ?? [],
        workspace_id: c.workspaceId,
        credentials: {
          lead: !!credentials.data?.lead_secret_hash,
          inventory: !!credentials.data?.inventory_token_encrypted,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e) {
    return dealerFailure(e);
  }
}
export async function POST(req: Request) {
  const blocked = await csrfGuard(req);
  if (blocked) return blocked;
  try {
    const c = await dealerContext();
    await assertDealerManager(c.db, c.workspaceId, c.userId);
    const b = object(await req.json());
    if (b.action === 'rotate_lead_key') {
      const key = randomBytes(32).toString('hex');
      checkDb(
        (
          await supabaseAdmin()
            .from('dealer_credentials')
            .upsert({
              workspace_id: c.workspaceId,
              lead_secret_hash: createHash('sha256').update(key).digest('hex'),
              updated_at: new Date().toISOString(),
            })
        ).error
      );
      return NextResponse.json(
        { key },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    if (b.action === 'inventory_token') {
      if (
        typeof b.token !== 'string' ||
        b.token.length > 2000 ||
        /[\r\n]/.test(b.token)
      )
        throw new DealerError('invalid');
      checkDb(
        (
          await supabaseAdmin()
            .from('dealer_credentials')
            .upsert({
              workspace_id: c.workspaceId,
              inventory_token_encrypted: b.token ? encrypt(b.token) : null,
              updated_at: new Date().toISOString(),
            })
        ).error
      );
      return NextResponse.json({ ok: true });
    }
    if (b.action !== 'save' || !Number.isInteger(b.version))
      throw new DealerError('invalid');
    const settings = dealerSettings(b.settings);
    const r = await c.db.rpc('dealer_save_settings', {
      p_workspace: c.workspaceId,
      p_version: b.version,
      p_settings: settings,
    });
    checkDb(r.error);
    return NextResponse.json({ settings, version: r.data });
  } catch (e) {
    return dealerFailure(e);
  }
}
