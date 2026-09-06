import { NextResponse } from 'next/server';
import type { VoiceConnectionConfig } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { isVoiceAdmin } from '@/lib/voice/voice-connection-store';
import { normalizeVoiceCapacity } from '@/lib/voice/capacity';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';

/**
 * Voice channel connection config (per workspace). Stores the merchant's DID,
 * inbound toggle, monthly minutes cap and kill switch on the
 * channel_connections row with channel='voice'. Session-authenticated.
 *
 * GET  ?workspace_id=  → { config, status } | { config: null }
 * PUT  { workspace_id, config } → upsert
 */
async function requireMember(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId)
    return NextResponse.json(
      { error: 'workspace_id required' },
      { status: 400 }
    );
  if (!(await requireMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { data } = await supabaseAdmin()
    .from('channel_connections')
    .select('config, status')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'voice')
    .maybeSingle();

  return NextResponse.json({
    config: (data as { config?: VoiceConnectionConfig } | null)?.config ?? null,
    status: (data as { status?: string } | null)?.status ?? null,
  });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    config?: VoiceConnectionConfig;
  } | null;
  if (!body?.workspace_id) {
    return NextResponse.json(
      { error: 'workspace_id required' },
      { status: 400 }
    );
  }
  // Comprar/liberar un número y enviar la documentación regulatoria exigen
  // admin, pero esta ruta pedía sólo ser miembro — así que cualquiera podía
  // reescribir el caller ID, el número de transferencia o el kill switch de
  // un número que sólo un admin pudo comprar. Mismo guard para todo.
  if (!(await isVoiceAdmin(user.id, body.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const admin = supabaseAdmin();
    const { data: existing } = await admin
      .from('channel_connections')
      .select('id, config')
      .eq('workspace_id', body.workspace_id)
      .eq('channel', 'voice')
      .maybeSingle();

    const prevConfig = ((existing as { config?: VoiceConnectionConfig } | null)
      ?.config ?? {}) as VoiceConnectionConfig;

    // MERGE onto what's stored, don't rebuild from a whitelist.
    //
    // This used to be a fresh object listing every field, which meant any key
    // the form didn't send got erased. That already destroyed one merchant's
    // APPROVED Telnyx regulatory file (patched field by field afterwards), and
    // the same trap fires again every time a control leaves the form. Merging
    // makes "not sent" mean "leave it alone" — the only safe default for a
    // config several different flows write to.
    const incoming = body.config ?? {};
    const owns = (key: keyof VoiceConnectionConfig) =>
      Object.prototype.hasOwnProperty.call(incoming, key);
    const cfg: VoiceConnectionConfig = { ...prevConfig, ...incoming };

    // This route is shared by small, independent cards. Only normalize keys
    // the caller actually sent; an omitted checkbox must not turn another
    // card's setting off.
    for (const key of [
      'inbound_enabled',
      'kill_switch',
      'recording_enabled',
      'recording_disclosure',
      'cod_mode',
    ] as const) {
      if (owns(key)) cfg[key] = Boolean(incoming[key]);
    }
    if (owns('monthly_minutes_limit')) {
      cfg.monthly_minutes_limit =
        incoming.monthly_minutes_limit == null
          ? null
          : Math.max(0, Number(incoming.monthly_minutes_limit) || 0);
    }
    if (owns('transfer_number')) {
      cfg.transfer_number = incoming.transfer_number?.trim() || undefined;
    }
    if (owns('fallback_transfer_number')) {
      const number = incoming.fallback_transfer_number?.trim() || '';
      if (number && !isValidE164(number)) {
        return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
      }
      cfg.fallback_transfer_number = number || undefined;
    }
    if (owns('fallback_language')) {
      cfg.fallback_language = incoming.fallback_language === 'en' ? 'en' : 'es';
    }
    if (owns('order_writeback')) {
      cfg.order_writeback = incoming.order_writeback
        ? {
            enabled: Boolean(incoming.order_writeback.enabled),
            confirmed_tag:
              incoming.order_writeback.confirmed_tag?.trim() || undefined,
            cancelled_tag:
              incoming.order_writeback.cancelled_tag?.trim() || undefined,
          }
        : undefined;
    }
    if (
      owns('max_concurrent_calls') ||
      owns('reserved_inbound_slots') ||
      owns('max_campaign_concurrent') ||
      owns('dedupe_minutes')
    ) {
      const capacity = normalizeVoiceCapacity(cfg);
      cfg.max_concurrent_calls = capacity.maxConcurrentCalls;
      cfg.reserved_inbound_slots = capacity.reservedInboundSlots;
      cfg.max_campaign_concurrent = capacity.maxCampaignConcurrent;
      cfg.dedupe_minutes = capacity.dedupeMinutes;
    }

    // The number and its country belong to the purchase + regulatory flow
    // (/api/voice/numbers). They were also editable by hand right below the
    // card that buys them, so a typo could leave `phone_number` pointing at a
    // number the workspace doesn't own while `telnyx_number_id` still pointed
    // at the real one. One owner now.
    cfg.phone_number = prevConfig.phone_number;
    cfg.country = prevConfig.country;
    cfg.telnyx_number_id = prevConfig.telnyx_number_id;
    cfg.regulatory_group_id = prevConfig.regulatory_group_id;
    cfg.regulatory_status = prevConfig.regulatory_status;

    const status = cfg.phone_number ? 'connected' : 'pending';

    if (existing) {
      await admin
        .from('channel_connections')
        .update({ config: cfg, status, label: 'Voz' })
        .eq('id', (existing as { id: string }).id);
    } else {
      await admin.from('channel_connections').insert({
        workspace_id: body.workspace_id,
        channel: 'voice',
        label: 'Voz',
        status,
        config: cfg,
      });
    }
    return NextResponse.json({ ok: true, config: cfg, status });
  } catch (err) {
    return serverError(err, 'save voice connection failed');
  }
}
