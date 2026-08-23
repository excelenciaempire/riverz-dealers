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
 * Por qué esta cuenta todavía no puede llamar.
 *
 * Los mismos criterios que cobra `enqueueCall`, pero nombrados: ahí las
 * barreras se cobran tarde y en silencio —`{ enqueued: false, reason }` que
 * termina en un log que nadie mira— y el comercio configura un nodo, lo activa
 * y no pasa nada, sin un solo cartel que diga qué falta.
 *
 * `fixHref` es lo que separa un aviso de una instrucción: dice DÓNDE se
 * arregla. Vacío cuando no lo arregla el comercio, que es el caso de
 * `platform_unavailable`.
 */
export type VoiceBlockerCode =
  | 'platform_unavailable'
  | 'no_voice_connection'
  | 'voice_disconnected'
  | 'no_number'
  | 'kill_switch'
  | 'monthly_limit_reached'
  | 'no_voice_agent'
  | 'agent_not_found'
  | 'agent_deleted'
  | 'voice_disabled'
  | 'agent_paused'
  | 'contact_not_found'
  | 'opt_out'
  | 'invalid_phone'
  | 'unknown'

export const VOICE_BLOCKED_FIX_HREF: Record<VoiceBlockerCode, string | null> = {
  // Falta configuración de plataforma (LiveKit): no lo arregla el comercio.
  platform_unavailable: null,
  no_voice_connection: '/voz',
  voice_disconnected: '/voz',
  no_number: '/voz',
  kill_switch: '/voz',
  monthly_limit_reached: '/voz',
  no_voice_agent: '/asistente',
  agent_not_found: '/asistente',
  agent_deleted: '/asistente',
  voice_disabled: '/asistente',
  agent_paused: '/asistente',
  contact_not_found: '/contactos',
  opt_out: '/contactos',
  invalid_phone: '/contactos',
  unknown: null,
}

const CODIGOS = new Set<string>(Object.keys(VOICE_BLOCKED_FIX_HREF))

/**
 * El `reason` que devuelve `enqueueCall`, como código.
 *
 * Casi todos coinciden con el nombre del código. Los que no —`insert_failed:…`
 * trae el mensaje de Postgres pegado— caen en `unknown` en vez de inventar una
 * clave: un cartel que dice "no se pudo" es honesto; uno que dice cualquier
 * otra cosa manda a arreglar donde no está el problema.
 */
export function blockerCodeFromReason(reason: string): VoiceBlockerCode {
  const limpio = (reason ?? '').split(':')[0].trim()
  return CODIGOS.has(limpio) ? (limpio as VoiceBlockerCode) : 'unknown'
}

/** Duración hablada como m:ss ("2:07"); guion cuando la llamada no conectó. */
export function fmtCallDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
