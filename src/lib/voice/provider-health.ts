import type { SupabaseClient } from '@supabase/supabase-js';
import { getVoiceModelConfig } from './model-config';

type State =
  | 'ok'
  | 'bajo'
  | 'sin_saldo'
  | 'desconocido'
  | 'sin_llave'
  | 'error';
type Snapshot = { provider: string; state: State; checked_at: string };

export interface VoiceProviderHealth {
  blocking: boolean;
  telephonyBlocking: boolean;
  aiBlocking: boolean;
  warning: boolean;
  stale: boolean;
}

const id = (provider: string | null | undefined) => {
  const value = (provider ?? '').toLowerCase();
  if (['fish', 'fishaudio', 'fish_audio'].includes(value)) return 'fish';
  if (value === 'google') return 'gemini';
  return value;
};

const unavailable = (state: State | undefined) =>
  state === 'sin_saldo' || state === 'sin_llave' || state === 'error';
const healthy = (state: State | undefined) =>
  state === 'ok' || state === 'bajo';

/** Aggregate only: callers never receive provider identities or raw probe data. */
export async function voiceProviderHealth(
  db: SupabaseClient
): Promise<VoiceProviderHealth> {
  const [{ data }, cfg] = await Promise.all([
    db.from('platform_provider_health').select('provider, state, checked_at'),
    getVoiceModelConfig(db),
  ]);
  const rows = (data ?? []) as Snapshot[];
  const states = new Map(rows.map((row) => [row.provider, row.state]));
  const latest = rows.reduce(
    (max, row) => Math.max(max, Date.parse(row.checked_at) || 0),
    0
  );
  const stale = latest > 0 && Date.now() - latest > 30 * 60 * 1000;
  let telephonyBlocking = false;
  let aiBlocking = false;
  let warning = stale || rows.length === 0;

  const telephony = states.get('telnyx');
  if (unavailable(telephony)) telephonyBlocking = true;
  else if (!telephony || telephony === 'bajo' || telephony === 'desconocido')
    warning = true;

  const layers =
    cfg.mode === 'realtime'
      ? [{ primary: id(cfg.realtime_provider), backup: '' }]
      : [
          {
            primary: id(cfg.stt_provider),
            backup: id(cfg.stt_provider) === 'deepgram' ? '' : 'deepgram',
          },
          {
            primary: id(cfg.llm_provider),
            backup: id(cfg.llm_provider) === 'anthropic' ? 'groq' : 'anthropic',
          },
          {
            primary: id(cfg.tts_provider),
            backup: id(cfg.tts_provider) === 'elevenlabs' ? '' : 'elevenlabs',
          },
        ];

  for (const layer of layers) {
    if (!layer.primary) {
      aiBlocking = true;
      continue;
    }
    const primary = states.get(layer.primary);
    if (primary === 'bajo' || primary === 'desconocido' || !primary)
      warning = true;
    if (!unavailable(primary)) continue;
    const backup = layer.backup ? states.get(layer.backup) : undefined;
    if (!layer.backup || !healthy(backup)) aiBlocking = true;
    else warning = true;
  }

  return {
    blocking: telephonyBlocking || aiBlocking,
    telephonyBlocking,
    aiBlocking,
    warning,
    stale,
  };
}
