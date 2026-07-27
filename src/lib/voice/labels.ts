/**
 * Voice — i18n key maps for the enums a call carries (estado, resultado, tipo,
 * dirección) y el formato de duración.
 *
 * Están acá y no en cada pantalla porque el registro de llamadas, el detalle y
 * la vista de la bandeja mostraban los mismos valores con tres copias del mismo
 * mapa: agregar un estado obligaba a acordarse de las tres.
 */
import type {
  VoiceCallDirection,
  VoiceCallOutcome,
  VoiceCallStatus,
  VoiceCallType,
} from '@/types';

export const VOICE_STATUS_KEY: Record<VoiceCallStatus, string> = {
  queued: 'voice.statusQueued',
  dialing: 'voice.statusDialing',
  in_progress: 'voice.statusInProgress',
  completed: 'voice.statusCompleted',
  failed: 'voice.statusFailed',
  no_answer: 'voice.statusNoAnswer',
  busy: 'voice.statusBusy',
  voicemail: 'voice.statusVoicemail',
  canceled: 'voice.statusCanceled',
};

export const VOICE_OUTCOME_KEY: Record<VoiceCallOutcome, string> = {
  confirmed: 'voice.outcomeConfirmed',
  cancelled_by_customer: 'voice.outcomeCancelled',
  rescheduled: 'voice.outcomeRescheduled',
  recovered: 'voice.outcomeRecovered',
  declined: 'voice.outcomeDeclined',
  callback_requested: 'voice.outcomeCallback',
  opt_out: 'voice.outcomeOptOut',
  no_outcome: 'voice.outcomeNone',
};

export const VOICE_TYPE_KEY: Record<VoiceCallType, string> = {
  order_confirmation: 'voice.typeOrderConfirmation',
  cart_recovery: 'voice.typeCartRecovery',
  followup: 'voice.typeFollowup',
  manual: 'voice.typeManual',
  inbound: 'voice.typeInbound',
};

export const VOICE_DIRECTION_KEY: Record<VoiceCallDirection, string> = {
  outbound: 'voice.directionOutbound',
  inbound: 'voice.directionInbound',
};

/** Duración hablada como m:ss ("2:07"); guion cuando la llamada no conectó. */
export function fmtCallDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
