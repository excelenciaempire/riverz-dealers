import type { SupabaseClient } from '@supabase/supabase-js';
import { reservar, liquidar } from '@/lib/wallet/operacion';
import type { VoiceCall } from '@/types';

function configuredRate(name: string) {
  const raw = process.env[name];
  const rate = raw ? Number(raw) : NaN;
  if (!Number.isFinite(rate) || rate < 0)
    throw new Error(`wallet_voice_rate_not_configured: ${name}`);
  return rate;
}
export async function reserveVoiceMedia(
  db: SupabaseClient,
  call: VoiceCall,
  seconds: number,
  sttProvider: string
) {
  // Rates must come from the account's variable usage agreement, never a monthly plan allocation.
  let rates = {
    stt: configuredRate('VOICE_STT_USD_PER_MIN'),
    telephony: configuredRate('VOICE_TELEPHONY_USD_PER_MIN'),
  };
  if (sttProvider !== 'deepgram')
    throw new Error('wallet_voice_stt_rate_not_configured');
  const existing = call.context?.wallet_media_operation;
  if (typeof existing === 'string') return;
  const duration = Math.min(Math.max(seconds, 1), 3600);
  const id = `voice-media:${call.id}`;
  try {
    await reservar(
      { db, workspaceId: call.workspace_id, concepto: 'llamada_voz' },
      'voice_media',
      Math.max(
        0.00001,
        Math.ceil((duration + 60) / 60) * (rates.stt + rates.telephony)
      ),
      { callId: call.id, rates },
      id
    );
  } catch (error) {
    const { data: held, error: readError } = await db
      .from('wallet_operaciones')
      .select('estado,detalle')
      .eq('id', id)
      .eq('workspace_id', call.workspace_id)
      .eq('proveedor', 'voice_media')
      .maybeSingle();
    if (readError || !held || held.estado !== 'reservada') throw error;
    rates = held.detalle.rates;
  }
  const { error } = await db
    .from('voice_calls')
    .update({
      context: {
        ...call.context,
        wallet_media_operation: id,
        wallet_media_rates: rates,
      },
    })
    .eq('id', call.id);
  if (error) throw new Error(error.message);
}
export async function settleVoiceMedia(
  db: SupabaseClient,
  call: VoiceCall,
  seconds: number,
  sttSeconds: number
) {
  const id = call.context?.wallet_media_operation;
  const rates = call.context?.wallet_media_rates as
    | { stt: number; telephony: number }
    | undefined;
  if (typeof id !== 'string' || !rates) return null;
  if (
    ![seconds, sttSeconds, rates.stt, rates.telephony].every(
      (n) => Number.isFinite(n) && n >= 0
    )
  )
    throw new Error('wallet_invalid_voice_usage');
  const stt = (sttSeconds / 60) * rates.stt,
    telephony = (seconds / 60) * rates.telephony;
  await liquidar(
    { db, workspaceId: call.workspace_id, concepto: 'llamada_voz' },
    id,
    'voice_media',
    stt + telephony,
    { callId: call.id, segundos: seconds, sttSeconds, rates },
    seconds / 60
  );
  return {
    stt_usd: stt,
    telephony_usd: telephony,
    llm_usd: 0,
    tts_usd: 0,
    total_usd: stt + telephony,
    minutes: seconds / 60,
  };
}
