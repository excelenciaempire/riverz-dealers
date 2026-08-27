/**
 * Voice AI — shared constants (defaults + curated voices).
 *
 * Single source of truth for the sensible defaults used both server-side
 * (context builder / queue) and in the agent editor UI, so a merchant who
 * never touches the Voz tab still gets a working phone agent.
 */
import type { VoiceCallType, VoiceCallingHours } from '@/types';

/** Call types that can be dialed OUTBOUND (inbound is answered, not dialed). */
export const OUTBOUND_CALL_TYPES: VoiceCallType[] = [
  'order_confirmation',
  'cart_recovery',
  'followup',
  'manual',
];

/** Every call type, including inbound. */
export const ALL_CALL_TYPES: VoiceCallType[] = [
  ...OUTBOUND_CALL_TYPES,
  'inbound',
];

/** Default calling window: Mon–Sat, 09:00–20:00 (workspace timezone). */
export const DEFAULT_CALLING_HOURS: VoiceCallingHours = {
  start: '09:00',
  end: '20:00',
  days: [1, 2, 3, 4, 5, 6],
};

export const DEFAULT_MAX_CALL_SECONDS = 300;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MINUTES = 120;

/**
 * Lo que sale un minuto de llamada, en dolares, para mostrarle un orden de
 * magnitud al comercio ANTES de que prenda el telefono.
 *
 * No es una factura: es el promedio medido el 2026-08-25 sobre llamadas reales
 * (STT + LLM + TTS + telefonia). Una de 19 segundos costo 0,0139 USD. El costo
 * exacto de cada llamada se calcula al terminarla y queda en `voice_calls.cost`.
 */
export const ESTIMATED_USD_PER_MINUTE = 0.05;

/**
 * Fallback objective per call type, per language. Used when the agent has
 * no `voice_objectives[call_type].objective` configured. Kept short and
 * transactional — the persona/knowledge come from the shared system prompt.
 */
export const DEFAULT_OBJECTIVES: Record<
  VoiceCallType,
  { es: string; en: string }
> = {
  order_confirmation: {
    es: 'Confirmar el pedido reciente del cliente: valida los productos, la dirección de envío y el método de pago. Si algo está mal, corrígelo o agenda una devolución de llamada.',
    en: "Confirm the customer's recent order: verify the items, shipping address and payment method. If something is wrong, correct it or schedule a callback.",
  },
  cart_recovery: {
    es: 'Ayudar al cliente a completar la compra que dejó en el carrito. Resuelve dudas y, si quiere, envíale el link de pago o cierra el pedido.',
    en: 'Help the customer complete the purchase they left in their cart. Answer questions and, if they want, send the payment link or close the order.',
  },
  followup: {
    es: 'Retomar el contacto con un cliente que dejó de responder por chat. Entender qué necesita y ayudarlo a avanzar.',
    en: 'Reconnect with a customer who stopped replying on chat. Understand what they need and help them move forward.',
  },
  manual: {
    es: 'Atender el objetivo que indique el equipo para esta llamada.',
    en: 'Handle the objective the team set for this call.',
  },
  inbound: {
    es: 'Atender la llamada entrante del cliente: escuchar su consulta, resolverla y, si aplica, ayudar con su pedido.',
    en: "Answer the customer's incoming call: listen to their query, resolve it and, if applicable, help with their order.",
  },
};

/** Default greeting per language ({{contact_name}} interpolated at call time). */
export const DEFAULT_GREETINGS: { es: string; en: string } = {
  es: 'Hola{{contact_name}}, te llamo de parte de la tienda. ¿Tienes un minuto?',
  en: "Hi{{contact_name}}, I'm calling on behalf of the store. Do you have a minute?",
};

/**
 * Saludo por defecto para Argentina. El saludo es lo PRIMERO que se escucha, y
 * un "¿tienes un minuto?" delata al toque que del otro lado no hay un argentino.
 * Sólo se usa si el comercio no escribió el suyo.
 */
export const DEFAULT_GREETING_AR =
  'Hola{{contact_name}}, te llamo de parte de la tienda. ¿Tenés un minuto?';

/**
 * Instrucciones de habla rioplatense para el agente (se suman al system prompt
 * en llamadas a Argentina). Es la mitad léxica del acento: el voseo y las
 * muletillas van en las PALABRAS que elige el modelo.
 *
 * La otra mitad —la fonética, `calle` → `cashe`— NO se pide acá a propósito: se
 * aplica en el worker justo antes del TTS (`voice-worker/rioplatense.py`), para
 * que la transcripción que ve el comercio quede en español legible.
 */
export const RIOPLATENSE_SPEECH = [
  '## Hablás como argentino',
  'La persona del otro lado es de Argentina. Hablá en castellano rioplatense, como alguien de Buenos Aires:',
  '- Voseo siempre: "vos", "tenés", "querés", "podés", "fijate", "decime", "mirá", "dale". Nunca "tú", "tienes", "quieres", "puedes".',
  '- Muletillas naturales de allá: "dale", "mirá", "che" (con moderación), "listo", "bárbaro", "un toque".',
  '- Vocabulario de allá: "plata" (no "dinero"), "celular", "heladera", "remera", "quilombo" sólo si el tono lo permite.',
  '- Nada de acentos de otros lados: ni "ahorita", ni "vale", ni "ustedes" para tratar a una sola persona.',
  // Regla heredada del skill veo3-script-director: estos símbolos rompen la
  // síntesis de voz (se leen raro o cortan la frase).
  '- No uses guiones largos ni puntos suspensivos: rompen la síntesis de voz. Usá comas y puntos.',
].join('\n');

/** Spoken recording disclosure, prepended to the greeting when recording is on. */
export const DEFAULT_RECORDING_DISCLOSURE: { es: string; en: string } = {
  es: 'Te comento que esta llamada puede ser grabada por calidad.',
  en: 'Just so you know, this call may be recorded for quality.',
};

/**
 * Curated ElevenLabs voices for the picker. voice_id values are the public
 * ElevenLabs voice ids; keep this list small and Latin-American first.
 * (The merchant can paste any ElevenLabs voice_id too.)
 */
export interface CuratedVoice {
  voice_id: string;
  label: string;
  /** Locale hint for the UI grouping. */
  locale: 'es-MX' | 'es-CO' | 'es-AR' | 'es-419' | 'en-US';
  gender: 'female' | 'male';
}

export const CURATED_VOICES: CuratedVoice[] = [
  // NOTE: these ids are well-known public ElevenLabs multilingual voices that
  // handle Latin-American Spanish well; the merchant can override with any id.
  { voice_id: 'XrExE9yKIg1WjnnlVkGX', label: 'Matilda', locale: 'es-419', gender: 'female' },
  { voice_id: 'pqHfZKP75CvOlQylNhV4', label: 'Bill', locale: 'es-419', gender: 'male' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', locale: 'es-419', gender: 'female' },
  { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam', locale: 'es-419', gender: 'male' },
];

export const DEFAULT_VOICE_ID = CURATED_VOICES[0].voice_id;
