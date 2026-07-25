/**
 * Voice AI — Meta Lead Ads → instant call.
 *
 * When a lead submits a Facebook/Instagram Lead Ad form, Meta sends a page
 * webhook with a `leadgen` change. We fetch the lead (name/phone) with the
 * page token, create/resolve the contact, and enqueue an immediate call.
 * Gated per-workspace by the voice connection's `lead_ads_enabled`. Fail-soft.
 *
 * NOTE: reading lead data requires the `leads_retrieval` permission on the
 * page token (Meta App Review). Until granted, the fetch returns empty and we
 * no-op — the plumbing is ready.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceConnectionConfig } from '@/types';
import { decrypt } from '@/lib/channels/encryption';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import { enqueueCall } from './queue';

const GRAPH = 'https://graph.facebook.com/v21.0';

interface LeadgenChange {
  leadgen_id: string;
  page_id: string;
  form_id?: string;
  ad_id?: string;
}

function extractLeadgen(payload: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const body = (payload ?? {}) as { entry?: Array<Record<string, unknown>> };
  for (const entry of body.entry ?? []) {
    const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
    for (const ch of changes) {
      if (ch.field !== 'leadgen') continue;
      const v = (ch.value ?? {}) as Record<string, unknown>;
      if (v.leadgen_id && v.page_id) {
        out.push({
          leadgen_id: String(v.leadgen_id),
          page_id: String(v.page_id),
          form_id: v.form_id ? String(v.form_id) : undefined,
          ad_id: v.ad_id ? String(v.ad_id) : undefined,
        });
      }
    }
  }
  return out;
}

/** Resolve the workspace + page token for a Meta page id. */
async function resolvePageConnection(
  db: SupabaseClient,
  pageId: string,
): Promise<{ workspaceId: string; token: string; config: VoiceConnectionConfig | null } | null> {
  const { data } = await db
    .from('channel_connections')
    .select('workspace_id, external_account_id, config, secrets')
    .in('channel', ['fb_comment', 'messenger', 'instagram']);
  const rows = (data ?? []) as {
    workspace_id: string;
    external_account_id: string | null;
    config: Record<string, unknown> | null;
    secrets: Record<string, unknown> | null;
  }[];
  const match = rows.find(
    (r) =>
      r.external_account_id === pageId ||
      String((r.config ?? {}).page_id ?? '') === pageId,
  );
  if (!match) return null;
  const tokenEnc = String((match.secrets ?? {}).access_token ?? '');
  if (!tokenEnc) return null;
  let token: string;
  try {
    token = decrypt(tokenEnc);
  } catch {
    return null;
  }
  // Voice connection config for the same workspace (lead_ads_enabled gate).
  const { data: voiceConn } = await db
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', match.workspace_id)
    .eq('channel', 'voice')
    .maybeSingle();
  return {
    workspaceId: match.workspace_id,
    token,
    config: (voiceConn as { config?: VoiceConnectionConfig } | null)?.config ?? null,
  };
}

/** Best voice-enabled agent for a workspace. */
async function pickAgent(db: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data } = await db
    .from('ai_agents')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .eq('voice_enabled', true)
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function fetchLead(
  token: string,
  leadgenId: string,
): Promise<{ name: string | null; phone: string | null }> {
  try {
    const res = await fetch(
      `${GRAPH}/${leadgenId}?fields=field_data&access_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return { name: null, phone: null };
    const json = (await res.json()) as {
      field_data?: { name: string; values: string[] }[];
    };
    let name: string | null = null;
    let phone: string | null = null;
    for (const f of json.field_data ?? []) {
      const key = (f.name || '').toLowerCase();
      const val = f.values?.[0] ?? '';
      if (!val) continue;
      if (key.includes('phone')) phone = val;
      else if (key.includes('name') && !name) name = val;
    }
    return { name, phone };
  } catch {
    return { name: null, phone: null };
  }
}

async function resolveContact(
  db: SupabaseClient,
  workspaceId: string,
  name: string | null,
  phone: string,
): Promise<string | null> {
  const e164 = phone.startsWith('+') ? phone : `+${phone.replace(/[^\d]/g, '')}`;
  const last8 = e164.slice(-8);
  const { data: candidates } = await db
    .from('contacts')
    .select('id, phone')
    .eq('workspace_id', workspaceId)
    .not('phone', 'is', null)
    .like('phone', `%${last8}`);
  const match = ((candidates ?? []) as { id: string; phone: string }[]).find((c) =>
    phonesMatch(c.phone, e164),
  );
  if (match) return match.id;
  const { data: created } = await db
    .from('contacts')
    .insert({
      workspace_id: workspaceId,
      channel: 'whatsapp',
      external_id: e164,
      phone: e164,
      name: name ?? undefined,
    })
    .select('id')
    .single();
  return (created as { id: string } | null)?.id ?? null;
}

/** Process a Meta page webhook for Lead Ads. Fire-and-forget. Never throws. */
export async function processLeadgen(db: SupabaseClient, payload: unknown): Promise<void> {
  try {
    const leads = extractLeadgen(payload);
    for (const lead of leads) {
      const conn = await resolvePageConnection(db, lead.page_id);
      if (!conn || !conn.config?.lead_ads_enabled) continue;
      const agentId = await pickAgent(db, conn.workspaceId);
      if (!agentId) continue;
      const { name, phone } = await fetchLead(conn.token, lead.leadgen_id);
      if (!phone) continue;
      const contactId = await resolveContact(db, conn.workspaceId, name, phone);
      if (!contactId) continue;
      await enqueueCall({
        workspaceId: conn.workspaceId,
        agentId,
        contactId,
        callType: 'manual',
        immediate: true,
        context: { source: 'lead_ad', ad_id: lead.ad_id ?? '', form_id: lead.form_id ?? '' },
      });
    }
  } catch (err) {
    console.error('[voice] processLeadgen failed:', err);
  }
}
