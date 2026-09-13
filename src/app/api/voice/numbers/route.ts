import { NextResponse } from 'next/server';
import type { VoiceConnectionConfig } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { redactModelSecrets } from '@/lib/security/model-secrets';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { currentNumberSubscription, purchaseNumber, releaseBilledNumber } from '@/lib/voice/number-billing';
import { verifyNumberQuote } from '@/lib/voice/number-quote';
import {
  isVoiceMember,
  isVoiceAdmin,
  readVoiceConfig,
  writeVoiceConfig,
} from '@/lib/voice/voice-connection-store';
import {
  releaseNumber,
  findOwnedNumber,
  TelnyxApiError,
  type PhoneNumberType,
} from '@/lib/voice/telnyx-numbers';

/**
 * Voice phone numbers — per-workspace self-serve provisioning.
 *   GET    → the workspace's current number (from the voice connection config)
 *   POST   → order a number (PAID) + attach it + persist as the workspace DID
 *   DELETE → release the number (stops the rental) + clear the config
 * GET is any member; POST/DELETE are admin-only (paid/destructive).
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!(await isVoiceMember(user.id, workspaceId)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { config } = await readVoiceConfig(workspaceId);
  let billingAvailable = true;
  const subscription = await currentNumberSubscription(supabaseAdmin(), workspaceId).catch((error) => {
    if (error instanceof Error && error.message === 'number_billing_unavailable') { billingAvailable = false; return null; }
    throw error;
  });
  return NextResponse.json({
    phone_number: config.phone_number ?? null,
    country: config.country ?? null,
    telnyx_number_id: config.telnyx_number_id ?? null,
    billing_available: billingAvailable,
    subscription: subscription ? { phone_number: subscription.phone_number, status: subscription.status, monthly_cents: subscription.monthly_cents, next_renewal_at: subscription.next_renewal_at, renewal_reserved: !!subscription.renewal_operation } : null,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    phone_number?: string;
    country?: string;
    type?: PhoneNumberType;
    requirement_group_id?: string;
    quote?: string;
    consent_version?: string;
  } | null;
  if (!body?.workspace_id || !body.phone_number) {
    return NextResponse.json({ error: 'workspace_id and phone_number required' }, { status: 400 });
  }
  if (!(await isVoiceAdmin(user.id, body.workspace_id)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Sin conexión de voz configurada, `orderNumber` OMITE `connection_id` del
  // pedido: Telnyx cobra el número, lo entrega, y las llamadas entrantes no
  // rutean a ninguna parte. La ruta respondía 200 y el comercio se enteraba
  // cuando nadie lo podía llamar. Es plata: mejor no vender el número.
  if (!process.env.TELNYX_VOICE_CONNECTION_ID) {
    return NextResponse.json({ error: 'voice_routing_unconfigured' }, { status: 503 });
  }

  const { config } = await readVoiceConfig(body.workspace_id);
  // One number per workspace: refuse if one is already provisioned (release
  // first). Guard on either field so a missing id can't reopen the door.
  if (config.telnyx_number_id || config.phone_number) {
    return NextResponse.json({ error: 'number_already_provisioned' }, { status: 409 });
  }

  try {
    if (body.consent_version !== 'number_v1' || typeof body.quote !== 'string') throw new Error('number_quote_invalid');
    const quote = verifyNumberQuote(body.quote, body.workspace_id, body.phone_number);
    // A regulatory group supplied by another workspace must never be used.
    if (body.requirement_group_id && body.requirement_group_id !== config.regulatory_group_id) throw new Error('number_quote_invalid');
    const ordered = await purchaseNumber(supabaseAdmin(), quote, user.id, body.requirement_group_id);
    return NextResponse.json(
      { ok: true, phone_number: ordered?.phone_number, status: ordered?.status },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('number_billing_unavailable')) return NextResponse.json({ error: translate(await getLocale(), 'voice.numberBillingUnavailable') }, { status: 503 });
    if (message.includes('sin_saldo')) return NextResponse.json({ error: translate(await getLocale(), 'voice.numberWalletInsufficient') }, { status: 402 });
    if (message.includes('number_quote_invalid')) return NextResponse.json({ error: translate(await getLocale(), 'voice.numberQuoteExpired') }, { status: 409 });
    if (message.includes('duplicate key') || message.includes('number_already_provisioned')) return NextResponse.json({ error: translate(await getLocale(), 'voice.numberPending') }, { status: 409 });
    if (err instanceof TelnyxApiError) {
      return NextResponse.json({
        error: translate(await getLocale(), 'voice.numberOrderFailed'),
        provider_code: err.code,
        diagnostic: redactModelSecrets(err.message),
      }, { status: err.status >= 400 && err.status < 500 ? err.status : 502 });
    }
    return serverError(err, 'number order failed');
  }
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!(await isVoiceAdmin(user.id, workspaceId)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id, config } = await readVoiceConfig(workspaceId);
  try {
    const subscription = await currentNumberSubscription(supabaseAdmin(), workspaceId).catch((error) => {
      if (error instanceof Error && error.message === 'number_billing_unavailable') return null;
      throw error;
    });
    if (subscription) {
      await releaseBilledNumber(supabaseAdmin(), subscription);
      return NextResponse.json({ ok: true });
    }
    // Prefer the stored Telnyx id; fall back to a lookup by number.
    const telnyxId = config.phone_number ? (await findOwnedNumber(config.phone_number))?.id : config.telnyx_number_id;
    if (telnyxId) await releaseNumber(telnyxId);
    const nextConfig: VoiceConnectionConfig = {
      ...config,
      phone_number: undefined,
      telnyx_number_id: undefined,
    };
    await writeVoiceConfig(workspaceId, id, nextConfig, 'disconnected');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, 'number release failed');
  }
}
