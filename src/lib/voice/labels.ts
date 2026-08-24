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

/**
 * Por qué no se pudo llamar.
 *
 * Vive acá, junto al resto de los mapas, y no en `readiness.ts`: ese módulo
 * habla con LiveKit y con la base, así que importarlo desde una pantalla
 * arrastraría el SDK del servidor al navegador. Esto es texto y nada más.
 *
 * Los códigos son los MISMOS que devuelve `enqueueCall.reason`, más los que
 * sólo se ven de antemano (`no_number`, `no_voice_agent`, plataforma caída).
 */
export type VoiceBlockerCode =
  | 'platform_unavailable'
  | 'no_voice_connection'
  | 'no_number'
  | 'voice_disconnected'
  | 'kill_switch'
  | 'monthly_limit_reached'
  | 'no_voice_agent'
  | 'agent_not_found'
  | 'agent_deleted'
  | 'agent_paused'
  | 'voice_disabled'
  | 'contact_not_found'
  | 'opt_out'
  | 'invalid_phone'
  | 'insert_failed';

export const VOICE_BLOCKED_KEY: Record<VoiceBlockerCode, string> = {
  platform_unavailable: 'voice.blockedPlatform',
  no_voice_connection: 'voice.blockedNoConnection',
  no_number: 'voice.blockedNoNumber',
  voice_disconnected: 'voice.blockedDisconnected',
  kill_switch: 'voice.blockedKillSwitch',
  monthly_limit_reached: 'voice.blockedMonthlyLimit',
  no_voice_agent: 'voice.blockedNoVoiceAgent',
  agent_not_found: 'voice.blockedAgentNotFound',
  agent_deleted: 'voice.blockedAgentDeleted',
  agent_paused: 'voice.blockedAgentPaused',
  voice_disabled: 'voice.blockedVoiceDisabled',
  contact_not_found: 'voice.blockedContactNotFound',
  opt_out: 'voice.blockedOptOut',
  invalid_phone: 'voice.blockedInvalidPhone',
  insert_failed: 'voice.blockedInsertFailed',
};

/** Dónde se destraba cada motivo. `null` = no lo arregla el comercio. */
export const VOICE_BLOCKED_FIX_HREF: Record<VoiceBlockerCode, string | null> = {
  platform_unavailable: null,
  no_voice_connection: '/voz',
  no_number: '/voz',
  voice_disconnected: '/voz',
  kill_switch: '/voz',
  monthly_limit_reached: '/voz',
  no_voice_agent: '/asistente',
  agent_not_found: '/asistente',
  agent_deleted: '/asistente',
  agent_paused: '/asistente',
  voice_disabled: '/asistente',
  contact_not_found: null,
  opt_out: null,
  invalid_phone: null,
  insert_failed: null,
};

/** Convierte un `reason` de `enqueueCall` en un código conocido. */
export function blockerCodeFromReason(reason: string): VoiceBlockerCode {
  const code = reason.startsWith('insert_failed')
    ? 'insert_failed'
    : (reason as VoiceBlockerCode);
  return code in VOICE_BLOCKED_KEY ? code : 'insert_failed';
}

/**
 * Cómo se lee el estado de una llamada en el registro.
 *
 * Una fila `canceled` con motivo es una llamada que NUNCA se marcó: la frenó
 * una barrera. Mostrarla como «Cancelada» a secas dejaba al comercio sin la
 * única información que importa, que es por qué.
 */
export function voiceStatusLabel(call: {
  status: VoiceCallStatus;
  error?: string | null;
}): { statusKey: string; reasonKey: string | null } {
  if (call.status === 'canceled' && call.error) {
    return {
      statusKey: 'voice.statusNotPlaced',
      reasonKey: VOICE_BLOCKED_KEY[blockerCodeFromReason(call.error)],
    };
  }
  return { statusKey: VOICE_STATUS_KEY[call.status], reasonKey: null };
}

/** Duración hablada como m:ss ("2:07"); guion cuando la llamada no conectó. */
export function fmtCallDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
