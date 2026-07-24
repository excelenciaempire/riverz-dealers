import type { Namespace } from "./types";

/**
 * Voice AI — phone agent settings, inbox call view, integration card,
 * metrics. All user-facing; both locales required.
 */
export const voice = {
  // ── Agent editor · Voz tab ──
  tab: { es: "Voz", en: "Voice" },
  enable: { es: "Agente de voz", en: "Voice agent" },
  enableHint: {
    es: "Permite que este agente haga y conteste llamadas por teléfono.",
    en: "Let this agent place and answer phone calls.",
  },
  voiceLabel: { es: "Voz", en: "Voice" },
  voicePickHint: {
    es: "La voz con la que hablará el agente. Escúchala antes de elegir.",
    en: "The voice the agent speaks with. Listen before choosing.",
  },
  preview: { es: "Escuchar", en: "Play sample" },
  previewPlaying: { es: "Reproduciendo…", en: "Playing…" },
  customVoiceId: { es: "O pega un ID de voz de ElevenLabs", en: "Or paste an ElevenLabs voice ID" },
  greeting: { es: "Saludo inicial", en: "Opening line" },
  greetingHint: {
    es: "Lo primero que dice al conectar. Usa {{contact_name}} para el nombre.",
    en: "The first thing said on connect. Use {{contact_name}} for the name.",
  },
  objectives: { es: "Objetivos por tipo de llamada", en: "Objectives by call type" },
  objectivesHint: {
    es: "Qué debe lograr el agente en cada tipo de llamada. Si lo dejas vacío, usa un objetivo por defecto.",
    en: "What the agent should accomplish per call type. Left empty, a default is used.",
  },
  objOrderConfirmation: { es: "Confirmar pedido", en: "Confirm order" },
  objCartRecovery: { es: "Recuperar carrito", en: "Recover cart" },
  objFollowup: { es: "Seguimiento (sin respuesta)", en: "Follow-up (no reply)" },
  objInbound: { es: "Llamada entrante", en: "Incoming call" },
  objEnabled: { es: "Activo", en: "On" },
  objPlaceholder: { es: "Describe el objetivo de la llamada…", en: "Describe the call objective…" },
  maxDuration: { es: "Duración máxima (segundos)", en: "Max duration (seconds)" },
  callingHours: { es: "Horario de llamadas", en: "Calling hours" },
  callingHoursHint: {
    es: "Solo se llama dentro de esta franja (zona horaria del espacio de trabajo).",
    en: "Calls only go out inside this window (workspace timezone).",
  },
  from: { es: "Desde", en: "From" },
  to: { es: "Hasta", en: "To" },
  days: { es: "Días", en: "Days" },
  retries: { es: "Reintentos si no contesta", en: "Retries if no answer" },
  retryDelay: { es: "Espera entre reintentos (min)", en: "Wait between retries (min)" },

  // ── Weekday short labels (ISO 1=Mon … 7=Sun) ──
  dayMon: { es: "Lun", en: "Mon" },
  dayTue: { es: "Mar", en: "Tue" },
  dayWed: { es: "Mié", en: "Wed" },
  dayThu: { es: "Jue", en: "Thu" },
  dayFri: { es: "Vie", en: "Fri" },
  daySat: { es: "Sáb", en: "Sat" },
  daySun: { es: "Dom", en: "Sun" },

  // ── Inbox · call view ──
  callInbound: { es: "Llamada entrante", en: "Incoming call" },
  callOutbound: { es: "Llamada saliente", en: "Outgoing call" },
  duration: { es: "Duración", en: "Duration" },
  outcome: { es: "Resultado", en: "Outcome" },
  summary: { es: "Resumen", en: "Summary" },
  noTranscript: { es: "Sin transcripción.", en: "No transcript." },
  callWithAi: { es: "Llamar con IA", en: "Call with AI" },
  calling: { es: "Llamando…", en: "Calling…" },
  callQueued: { es: "Llamada en cola", en: "Call queued" },
  callFailed: { es: "No se pudo iniciar la llamada", en: "Could not start the call" },

  // Statuses
  statusQueued: { es: "En cola", en: "Queued" },
  statusDialing: { es: "Marcando", en: "Dialing" },
  statusInProgress: { es: "En curso", en: "In progress" },
  statusCompleted: { es: "Completada", en: "Completed" },
  statusFailed: { es: "Fallida", en: "Failed" },
  statusNoAnswer: { es: "Sin respuesta", en: "No answer" },
  statusBusy: { es: "Ocupado", en: "Busy" },
  statusVoicemail: { es: "Buzón de voz", en: "Voicemail" },
  statusCanceled: { es: "Cancelada", en: "Canceled" },

  // Outcomes
  outcomeConfirmed: { es: "Confirmado", en: "Confirmed" },
  outcomeCancelled: { es: "Cancelado por el cliente", en: "Cancelled by customer" },
  outcomeRescheduled: { es: "Reagendado", en: "Rescheduled" },
  outcomeRecovered: { es: "Compra recuperada", en: "Purchase recovered" },
  outcomeDeclined: { es: "Rechazó", en: "Declined" },
  outcomeCallback: { es: "Pidió que lo vuelvan a llamar", en: "Asked for a callback" },
  outcomeOptOut: { es: "Pidió no ser llamado", en: "Asked not to be called" },
  outcomeNone: { es: "Sin resultado", en: "No outcome" },

  // ── Contact · opt-out ──
  optOut: { es: "No llamar", en: "Do not call" },
  optOutHint: {
    es: "El agente de voz no llamará a este contacto.",
    en: "The voice agent won't call this contact.",
  },

  // ── Integrations · voice card ──
  cardTitle: { es: "Voz / Teléfono", en: "Voice / Phone" },
  cardDesc: {
    es: "Agentes de voz que llaman y contestan por teléfono.",
    en: "Voice agents that call and answer by phone.",
  },
  phoneNumber: { es: "Número asignado", en: "Assigned number" },
  phoneNumberPlaceholder: { es: "+57 …", en: "+1 …" },
  country: { es: "País", en: "Country" },
  inboundEnabled: { es: "Contestar llamadas entrantes", en: "Answer incoming calls" },
  monthlyLimit: { es: "Límite de minutos al mes", en: "Monthly minutes limit" },
  monthlyLimitHint: { es: "0 = sin límite", en: "0 = unlimited" },
  killSwitch: { es: "Pausar todas las llamadas", en: "Pause all calls" },
  killSwitchHint: {
    es: "Detiene de inmediato las llamadas salientes y entrantes.",
    en: "Immediately stops outbound and inbound calls.",
  },
  connected: { es: "Conectado", en: "Connected" },
  notConnected: { es: "Sin configurar", en: "Not set up" },
  save: { es: "Guardar", en: "Save" },
  saved: { es: "Guardado", en: "Saved" },

  // ── Metrics ──
  metricsTitle: { es: "Llamadas de voz", en: "Voice calls" },
  metricTotal: { es: "Llamadas", en: "Calls" },
  metricAnswered: { es: "Contestadas", en: "Answered" },
  metricMinutes: { es: "Minutos", en: "Minutes" },
  metricCost: { es: "Costo estimado", en: "Estimated cost" },
} satisfies Namespace;
