import type { Namespace } from './types';

/**
 * Voice AI — phone agent settings, inbox call view, integration card,
 * metrics. All user-facing; both locales required.
 */
export const voice = {
  // ── Agent editor · Voz tab ──
  tab: { es: 'Llamadas', en: 'Calls' },
  enable: { es: 'Agente de voz', en: 'Voice agent' },
  voiceLabel: { es: 'Voz del agente', en: 'Agent voice' },
  greeting: { es: 'Saludo inicial', en: 'Opening line' },
  greetingHint: {
    es: 'Lo primero que dice al conectar. Usa {{contact_name}} para el nombre.',
    en: 'The first thing said on connect. Use {{contact_name}} for the name.',
  },
  objectives: {
    es: 'Objetivos por tipo de llamada',
    en: 'Objectives by call type',
  },
  objectivesHint: {
    es: 'Vacío, usa un objetivo por defecto.',
    en: 'Left empty, a default is used.',
  },
  // Los nombres de los cuatro tipos viven en `type*` (abajo) — son los mismos
  // que muestra el registro de llamadas, y tenerlos dos veces hacía que la
  // misma llamada se llamara distinto según la pantalla.
  objEnabled: { es: 'Activo', en: 'On' },
  objPlaceholder: {
    es: 'Describe el objetivo de la llamada…',
    en: 'Describe the call objective…',
  },
  objFollowupSharedDelay: {
    es: 'Usa el mismo tiempo de espera que el seguimiento por mensaje, en Avanzado.',
    en: 'Uses the same wait time as the message follow-up, under Advanced.',
  },
  callingHours: { es: 'Horario de llamadas', en: 'Calling hours' },
  callingHoursHint: {
    es: 'Solo se llama dentro de esta franja (zona horaria del espacio de trabajo).',
    en: 'Calls only go out inside this window (workspace timezone).',
  },
  from: { es: 'Desde', en: 'From' },
  to: { es: 'Hasta', en: 'To' },
  hoursOvernight: {
    es: 'Turno noche: sigue hasta esa hora del día siguiente.',
    en: 'Overnight: runs until that time the next day.',
  },
  hoursNoDays: {
    es: 'Elige al menos un día.',
    en: 'Choose at least one day.',
  },
  retries: { es: 'Si no contesta', en: 'If nobody answers' },
  retriesHint: {
    es: 'Con un par de horas entre intento e intento.',
    en: 'A couple of hours between attempts.',
  },
  retriesNone: { es: 'No insistir', en: "Don't retry" },
  retriesOnce: { es: 'Insistir 1 vez', en: 'Retry once' },
  retriesTwice: { es: 'Insistir 2 veces', en: 'Retry twice' },

  // AI-assisted setup + "AI decides"
  setupTitle: { es: 'Configurar con IA', en: 'Set up with AI' },
  setupHint: {
    es: 'Describe en tus palabras cuándo quieres que el agente llame y lo configuramos por ti.',
    en: 'Describe in your words when the agent should call and we set it all up for you.',
  },
  setupPlaceholder: {
    es: 'Ej: que llame para confirmar cada pedido y para recuperar carritos si no responden por chat.',
    en: "E.g. call to confirm every order and to recover carts if they don't reply on chat.",
  },
  setupApply: { es: 'Generar', en: 'Generate' },
  setupApplied: { es: 'Configuración aplicada', en: 'Configuration applied' },
  setupError: {
    es: 'No se pudo generar la configuración',
    en: "Couldn't generate the setup",
  },
  aiDecides: {
    es: 'Dejar que la IA decida cuándo llamar',
    en: 'Let the AI decide when to call',
  },
  aiDecidesHint: {
    es: "En medio del chat, el agente puede llamar si conviene (cliente lo pide, urgente, alto valor). Respeta horario y 'no llamar'.",
    en: "Mid-chat, the agent can call when it helps (customer asks, urgent, high value). Respects hours and 'do not call'.",
  },
  linkTitle: { es: 'Llamadas', en: 'Calls' },
  linkHint: {
    es: 'Conecta el agente de voz que usará este asistente.',
    en: 'Connect the voice agent this assistant will use.',
  },
  linkNone: { es: 'Sin agente vinculado', en: 'No agent linked' },
  linkEmpty: {
    es: 'Aún no hay agentes de voz.',
    en: 'There are no voice agents yet.',
  },
  linkCreate: {
    es: 'Crear agente en Llamadas',
    en: 'Create agent in Calls',
  },
  linkPropose: {
    es: 'Ofrecer una llamada en el chat',
    en: 'Offer a call in chat',
  },
  linkProposeHint: {
    es: 'Solo cuando el cliente la pida o acepte recibirla.',
    en: 'Only when the customer asks for or accepts it.',
  },
  voiceAgentsTitle: { es: 'Agentes de voz', en: 'Voice agents' },
  voiceAgentsHint: {
    es: 'Crea y configura aquí quién habla por teléfono. Luego vincúlalo a un asistente de chat o a una automatización.',
    en: 'Create and configure who speaks by phone here. Then link it to a chat assistant or an automation.',
  },
  voiceAgentCreate: { es: 'Crear agente', en: 'Create agent' },
  voiceAgentFirst: {
    es: 'Crear mi primer agente',
    en: 'Create my first agent',
  },
  voiceAgentCancel: { es: 'Cancelar', en: 'Cancel' },
  voiceAgentNewTitle: { es: 'Nuevo agente de voz', en: 'New voice agent' },
  voiceAgentDialogHint: {
    es: 'Configura cómo habla y atiende las llamadas.',
    en: 'Configure how it speaks and handles calls.',
  },
  voiceAgentNameLabel: { es: 'Nombre', en: 'Name' },
  voiceAgentName: { es: 'Ej. Ventas', en: 'E.g. Sales' },
  voiceAgentChooseVoice: {
    es: 'Elige una voz para continuar.',
    en: 'Choose a voice to continue.',
  },
  voiceAgentsEmptyTitle: {
    es: 'Dale una voz a tu negocio',
    en: 'Give your business a voice',
  },
  voiceAgentsEmpty: {
    es: 'Elige cómo habla, qué dice y cuándo está disponible.',
    en: 'Choose how it speaks, what it says, and when it is available.',
  },
  voiceAgentActive: { es: 'Activo para llamadas', en: 'Active for calls' },
  voiceAgentReady: { es: 'Listo para llamar', en: 'Ready to call' },
  voiceAgentNeedsVoice: { es: 'Falta elegir una voz', en: 'Choose a voice' },
  voiceAgentLinkedCount: {
    es: 'Vinculado en {count}',
    en: 'Linked in {count}',
  },
  voiceAgentPaused: { es: 'Pausado', en: 'Paused' },
  voiceAgentCreated: { es: 'Agente de voz creado', en: 'Voice agent created' },
  voiceAgentCreateFailed: {
    es: 'No se pudo crear el agente de voz.',
    en: "Couldn't create the voice agent.",
  },
  voiceAgentSaved: { es: 'Agente de voz guardado', en: 'Voice agent saved' },
  voiceAgentSaveFailed: {
    es: 'No se pudo guardar el agente de voz.',
    en: "Couldn't save the voice agent.",
  },
  voiceAgentDelete: { es: 'Eliminar agente', en: 'Delete agent' },
  voiceAgentDeleteTitle: {
    es: '¿Eliminar este agente?',
    en: 'Delete this agent?',
  },
  voiceAgentDeleteHint: {
    es: 'Se eliminará {name}. El historial de llamadas se conserva.',
    en: '{name} will be deleted. Call history will be kept.',
  },
  voiceAgentDeleteLinked: {
    es: '{count} vínculos dejarán de usar este agente.',
    en: '{count} links will stop using this agent.',
  },
  voiceAgentDeleteConfirm: { es: 'Sí, eliminar', en: 'Delete agent' },
  voiceAgentDeleted: { es: 'Agente eliminado', en: 'Agent deleted' },
  voiceAgentDeleteFailed: {
    es: 'No se pudo eliminar el agente.',
    en: "Couldn't delete the agent.",
  },

  // ── Weekday short labels (ISO 1=Mon … 7=Sun) ──
  dayMon: { es: 'Lun', en: 'Mon' },
  dayTue: { es: 'Mar', en: 'Tue' },
  dayWed: { es: 'Mié', en: 'Wed' },
  dayThu: { es: 'Jue', en: 'Thu' },
  dayFri: { es: 'Vie', en: 'Fri' },
  daySat: { es: 'Sáb', en: 'Sat' },
  daySun: { es: 'Dom', en: 'Sun' },

  // ── Inbox · call view ──
  callInbound: { es: 'Llamada entrante', en: 'Incoming call' },
  callOutbound: { es: 'Llamada saliente', en: 'Outgoing call' },
  duration: { es: 'Duración', en: 'Duration' },
  outcome: { es: 'Resultado', en: 'Outcome' },
  summary: { es: 'Resumen', en: 'Summary' },
  noTranscript: { es: 'Sin transcripción.', en: 'No transcript.' },
  callWithAi: { es: 'Llamar con IA', en: 'Call with AI' },
  callQueued: { es: 'Llamada en cola', en: 'Call queued' },
  callFailed: {
    es: 'No se pudo iniciar la llamada',
    en: 'Could not start the call',
  },

  // Statuses
  statusQueued: { es: 'En cola', en: 'Queued' },
  statusDialing: { es: 'Marcando', en: 'Dialing' },
  statusInProgress: { es: 'En curso', en: 'In progress' },
  statusCompleted: { es: 'Completada', en: 'Completed' },
  statusFailed: { es: 'Fallida', en: 'Failed' },
  statusNoAnswer: { es: 'Sin respuesta', en: 'No answer' },
  statusBusy: { es: 'Ocupado', en: 'Busy' },
  statusVoicemail: { es: 'Buzón de voz', en: 'Voicemail' },
  statusCanceled: { es: 'Cancelada', en: 'Canceled' },
  // Se intento y una barrera la freno: nunca sono un telefono. Es distinto de
  // "sin respuesta" — ahi si se marco y no atendieron.
  statusNotPlaced: { es: 'No se llamó', en: 'Not placed' },

  // La pestaña de llamadas del agente.
  voiceDefault: { es: 'La de la plataforma', en: 'The platform default' },
  voicePlatform: {
    es: 'La voz de las llamadas la define la plataforma.',
    en: 'The calling voice is set by the platform.',
  },
  voiceLibrary: { es: 'Biblioteca de voces', en: 'Voice library' },
  voiceAvailable: { es: 'Voces disponibles', en: 'Available voices' },
  voiceLibrarySearch: { es: 'Buscar en Fish Audio', en: 'Search Fish Audio' },
  voiceLibrarySearchAction: { es: 'Buscar', en: 'Search' },
  voiceLibraryPrevious: { es: 'Anterior', en: 'Previous' },
  voiceLibraryNext: { es: 'Siguiente', en: 'Next' },
  voiceLibraryFallback: {
    es: 'No se pudo cargar Fish Audio. Estas voces verificadas siguen disponibles.',
    en: "Fish Audio couldn't be loaded. These verified voices are still available.",
  },
  voiceLibraryUnavailable: {
    es: 'No se pudo cargar la biblioteca de Fish Audio.',
    en: "Couldn't load the Fish Audio library.",
  },
  voiceLibraryRetry: { es: 'Reintentar', en: 'Try again' },
  voiceLibraryNoResults: {
    es: 'No hay voces que coincidan con la búsqueda.',
    en: 'No voices match this search.',
  },
  voicePreviewFailed: {
    es: 'No se pudo reproducir la vista previa.',
    en: "Couldn't play the preview.",
  },
  voicePreview: { es: 'Escuchar', en: 'Listen' },
  voicePreviewStop: { es: 'Detener', en: 'Stop' },
  voiceSelected: { es: 'Voz seleccionada', en: 'Selected voice' },
  voiceNone: { es: 'Elige una voz', en: 'Choose a voice' },
  voiceCustom: { es: 'Tus voces', en: 'Your voices' },
  voiceCreate: { es: 'Crear voz', en: 'Create voice' },
  voiceCreateTitle: { es: 'Crear una voz propia', en: 'Create your own voice' },
  voiceName: { es: 'Nombre de la voz', en: 'Voice name' },
  voiceNamePlaceholder: { es: 'Ej: Voz de Laura', en: "E.g. Laura's voice" },
  voiceSamples: { es: 'Audios de referencia', en: 'Reference audio' },
  voiceSamplesHint: {
    es: '1 a 3 audios claros, de una sola persona. MP3, WAV, M4A u OGG; hasta 10 MB cada uno.',
    en: '1 to 3 clear, single-speaker clips. MP3, WAV, M4A, or OGG; up to 10 MB each.',
  },
  voiceConsent: {
    es: 'Confirmo que tengo permiso para usar y clonar esta voz.',
    en: 'I confirm I have permission to use and clone this voice.',
  },
  voiceCreateAction: { es: 'Crear voz', en: 'Create voice' },
  voiceCancel: { es: 'Cancelar', en: 'Cancel' },
  voiceCreating: { es: 'Creando…', en: 'Creating…' },
  voiceCreated: { es: 'Voz creada', en: 'Voice created' },
  voiceCloneInvalid: {
    es: 'Revisa el nombre, el permiso y los audios seleccionados.',
    en: 'Check the name, permission, and selected audio files.',
  },
  voiceCloneFailed: {
    es: 'No se pudo crear la voz.',
    en: "Couldn't create the voice.",
  },
  voiceFishUnavailable: {
    es: 'Fish Audio no está listo para crear voces.',
    en: "Fish Audio isn't ready to create voices.",
  },
  voiceUnauthorized: {
    es: 'Inicia sesión para continuar.',
    en: 'Sign in to continue.',
  },
  voiceForbidden: {
    es: 'No tienes permiso para administrar voces.',
    en: "You don't have permission to manage voices.",
  },
  voiceTraining: { es: 'Preparando voz…', en: 'Preparing voice…' },
  voiceTrainingStarted: {
    es: 'Estamos preparando tu voz. Podrás elegirla cuando esté lista.',
    en: "We're preparing your voice. You can select it when it's ready.",
  },
  voiceTrainingFailed: { es: 'No se pudo preparar', en: "Couldn't prepare" },
  whenGroup: { es: 'Cuándo insiste', en: 'When it keeps trying' },
  whenGroupHint: {
    es: 'Horario y reintentos de este agente de voz.',
    en: 'This voice agent’s hours and retries.',
  },

  // La linea de estado: si el telefono puede sonar, en un renglon.
  canCallFrom: {
    es: 'Puede llamar desde {number}',
    en: 'Can call from {number}',
  },
  canCall: { es: 'Puede llamar', en: 'Can call' },
  answeredBy: { es: '· atiende {name}', en: '· answered by {name}' },
  answeredByMany: {
    es: '· atienden {count} asistentes',
    en: '· {count} assistants answer',
  },
  cannotCall: { es: 'No puede llamar.', en: 'Cannot call.' },
  callsWarning: { es: 'Atención:', en: 'Heads up:' },

  // Por que no se puede llamar. Un solo juego de frases para el lienzo, la
  // pantalla de Voz, el registro y lo que el agente de chat le contesta al
  // comercio. Cada una dice DONDE se arregla, no solo que pasa.
  blockedPlatform: {
    es: 'El servicio de llamadas no está disponible en este momento.',
    en: 'The calling service is unavailable right now.',
  },
  // El worker de voz dejó de latir. Es de la plataforma, no del comercio: la
  // frase no promete que lo pueda arreglar, y por eso no lleva enlace.
  blockedWorkerDown: {
    es: 'El servicio que marca los teléfonos no responde. Ya estamos avisados.',
    en: 'The service that dials phones is not responding. We have been alerted.',
  },
  blockedNoConnection: {
    es: 'Esta cuenta todavía no tiene el canal de voz conectado.',
    en: 'This account has no voice channel connected yet.',
  },
  blockedNoNumber: {
    es: 'Falta un número de teléfono para llamar desde él.',
    en: 'A phone number to call from is missing.',
  },
  blockedDisconnected: {
    es: 'El canal de voz está desconectado.',
    en: 'The voice channel is disconnected.',
  },
  blockedKillSwitch: {
    es: 'El freno de emergencia está activado: no sale ninguna llamada.',
    en: 'The emergency stop is on: no calls go out.',
  },
  blockedMonthlyLimit: {
    es: 'Se llegó al tope de minutos del mes.',
    en: 'The monthly minutes cap has been reached.',
  },
  blockedNoVoiceAgent: {
    es: 'Ningún agente tiene la voz activada.',
    en: 'No agent has voice enabled.',
  },
  blockedAgentNotFound: {
    es: 'Ese agente no existe en esta cuenta.',
    en: 'That agent does not exist in this account.',
  },
  blockedAgentDeleted: {
    es: 'Ese agente está borrado.',
    en: 'That agent is deleted.',
  },
  blockedAgentPaused: {
    es: 'Ese agente está pausado.',
    en: 'That agent is paused.',
  },
  blockedVoiceDisabled: {
    es: 'Este agente no tiene la voz activada.',
    en: 'This agent does not have voice enabled.',
  },
  blockedContactNotFound: {
    es: 'Ese contacto no existe en esta cuenta.',
    en: 'That contact does not exist in this account.',
  },
  blockedOptOut: {
    es: 'El contacto pidió no recibir llamadas.',
    en: 'The contact asked not to receive calls.',
  },
  blockedInvalidPhone: {
    es: 'El teléfono del contacto no es un número válido.',
    en: "The contact's phone is not a valid number.",
  },
  // La etiqueta del enlace que lleva a arreglar el bloqueo. Faltaba, así que
  // el aviso imprimía «voice.blockedFix» en la pantalla del comercio.
  blockedFix: { es: 'Arreglar', en: 'Fix it' },
  blockedInsertFailed: {
    es: 'No se pudo guardar la llamada.',
    en: 'The call could not be saved.',
  },
  // Advertencia, no bloqueo: sale llamar, pero las que entran se pierden.
  blockedInboundDisabled: {
    es: 'Las llamadas que entran a este número no se atienden.',
    en: 'Incoming calls to this number are not answered.',
  },

  // Outcomes
  outcomeConfirmed: { es: 'Confirmado', en: 'Confirmed' },
  outcomeCancelled: {
    es: 'Cancelado por el cliente',
    en: 'Cancelled by customer',
  },
  outcomeRescheduled: { es: 'Reagendado', en: 'Rescheduled' },
  outcomeRecovered: { es: 'Compra recuperada', en: 'Purchase recovered' },
  outcomeDeclined: { es: 'Rechazó', en: 'Declined' },
  outcomeCallback: {
    es: 'Pidió que lo vuelvan a llamar',
    en: 'Asked for a callback',
  },
  outcomeOptOut: { es: 'Pidió no ser llamado', en: 'Asked not to be called' },
  outcomeNone: { es: 'Sin resultado', en: 'No outcome' },

  // ── Contact · opt-out ──
  optOut: { es: 'No llamar', en: 'Do not call' },

  // ── Integrations · voice card ──
  phoneNumber: { es: 'Número asignado', en: 'Assigned number' },
  phoneNumberPlaceholder: { es: '+57 …', en: '+1 …' },
  inboundEnabled: {
    es: 'Contestar llamadas entrantes',
    en: 'Answer incoming calls',
  },
  monthlyLimit: { es: 'Límite de minutos al mes', en: 'Monthly minutes limit' },
  monthlyLimitHint: { es: '0 = sin límite', en: '0 = unlimited' },
  testCall: { es: 'Probar llamada', en: 'Test call' },
  testCallPlaceholder: { es: '+54 9 11 1234 5678', en: '+1 555 123 4567' },
  testCallQueued: { es: 'Llamando ahora', en: 'Calling now' },
  testCallAccountPaused: {
    es: 'La cuenta no está habilitada para realizar llamadas.',
    en: 'The account is not enabled to place calls.',
  },
  testCallSaveFirst: {
    es: 'Guarda el agente antes de probar la llamada.',
    en: 'Save the agent before testing the call.',
  },
  recordingEnabled: { es: 'Grabar llamadas', en: 'Record calls' },
  recordingDisclosure: { es: 'Avisar que se graba', en: 'Announce recording' },
  recordingDisclosureHint: {
    es: 'El agente lo dice al saludar. Obligatorio para grabar en varios lugares (California, Florida, la UE…).',
    en: 'The agent says it in the greeting. Required to record in several places (California, Florida, the EU…).',
  },
  recordingHint: {
    es: 'Guarda el audio; se escucha desde el registro de llamadas.',
    en: 'Saves the audio; you can play it from the call log.',
  },
  transferNumber: {
    es: 'Transferir a un humano (número)',
    en: 'Transfer to a human (number)',
  },
  connected: { es: 'Conectado', en: 'Connected' },
  notConnected: { es: 'Sin configurar', en: 'Not set up' },
  save: { es: 'Guardar', en: 'Save' },
  saved: { es: 'Guardado', en: 'Saved' },

  // ── Metrics ──
  metricsTitle: { es: 'Llamadas de voz', en: 'Voice calls' },
  metricTotal: { es: 'Llamadas', en: 'Calls' },
  metricAnswered: { es: 'Contestadas', en: 'Answered' },
  metricMinutes: { es: 'Minutos', en: 'Minutes' },
  metricCost: { es: 'Costo estimado', en: 'Estimated cost' },

  // ── Merchant "Voz" page ──
  // ── Pantalla de Llamadas ──
  // Cada cosa que falta se dice donde se arregla, no en un cartel aparte que
  // repita las mismas frases.
  pageDesc: {
    es: 'Tu agente llama y contesta por teléfono.',
    en: 'Your agent calls and answers the phone.',
  },
  usageThisMonth: {
    es: '{minutes} min este mes',
    en: '{minutes} min this month',
  },
  usageOf: { es: 'de {limit}', en: 'of {limit}' },

  numberChange: { es: 'Cambiar', en: 'Change' },
  // Los dos grupos de la pantalla: lo que se arma una vez y lo que se mira
  // todas las semanas. Sin ellos eran siete tarjetas iguales apiladas.
  setupGroup: { es: 'Configuración', en: 'Setup' },
  voiceSetupHint: {
    es: 'Prepara tu número, tu agente y las reglas de llamada.',
    en: 'Set up your number, agent, and calling rules.',
  },
  activityGroup: { es: 'Actividad', en: 'Activity' },
  whoAnswers: { es: 'Quién atiende', en: 'Who answers' },
  whoAnswersNone: {
    es: 'Ningún agente tiene la voz activada.',
    en: 'No agent has voice enabled.',
  },
  whoAnswersTurnOn: {
    es: 'Activar la voz de un agente',
    en: "Turn on an agent's voice",
  },
  behaviourTitle: { es: 'Políticas generales', en: 'General policies' },
  behaviourHint: {
    es: 'Aplican a todos los agentes de voz.',
    en: 'Apply to every voice agent.',
  },
  inboundHint: {
    es: 'El agente atiende cuando alguien llama a tu número.',
    en: 'The agent answers when someone calls your number.',
  },
  unsavedChanges: { es: 'Cambios sin guardar', en: 'Unsaved changes' },
  allSaved: { es: 'Todo guardado', en: 'Everything saved' },
  capacityTitle: { es: 'Capacidad', en: 'Capacity' },
  capacityHint: {
    es: 'Ordena el tráfico y evita que una campaña bloquee las demás llamadas.',
    en: 'Orders traffic and prevents a campaign from blocking other calls.',
  },
  capacityInProgress: { es: 'En curso', en: 'In progress' },
  capacityActiveMix: {
    es: '{inbound} entrantes · {outbound} salientes',
    en: '{inbound} incoming · {outbound} outgoing',
  },
  capacityQueued: { es: 'En cola', en: 'Queued' },
  capacityInboundReserve: { es: 'Reserva entrante', en: 'Inbound reserve' },
  capacityReserveOff: { es: 'Sin reserva', en: 'No reserve' },
  capacityDialogTitle: { es: 'Capacidad de llamadas', en: 'Call capacity' },
  capacityDialogHint: {
    es: 'Define cuántas conversaciones pueden ocurrir al mismo tiempo.',
    en: 'Set how many conversations can happen at the same time.',
  },
  capacityMaxTitle: { es: 'Máximo simultáneo', en: 'Concurrent maximum' },
  capacityMaxHint: {
    es: 'Incluye entrantes y salientes.',
    en: 'Includes incoming and outgoing calls.',
  },
  capacityReserveTitle: {
    es: 'Reservar para entrantes',
    en: 'Reserve for incoming',
  },
  capacityReserveHint: {
    es: 'Mantiene líneas libres aunque haya llamadas salientes.',
    en: 'Keeps lines free while outgoing calls are running.',
  },
  capacityCampaignTitle: { es: 'Máximo por campañas', en: 'Campaign maximum' },
  capacityCampaignHint: {
    es: 'Evita que una campaña ocupe toda la capacidad.',
    en: 'Prevents one campaign from using all capacity.',
  },
  agentControlTitle: { es: 'Control de llamadas', en: 'Call controls' },
  agentControlHint: {
    es: 'Capacidad, grabación y límites de este agente.',
    en: "This agent's capacity, recording, and limits.",
  },
  agentCapacityMaxHint: {
    es: 'Conversaciones que puede mantener a la vez.',
    en: 'Conversations it can handle at once.',
  },
  agentReserveHint: {
    es: 'Guarda capacidad para quien llame.',
    en: 'Keeps capacity available for incoming callers.',
  },
  agentPriorityOrder: {
    es: 'Entrantes → manuales → automatizaciones → campañas',
    en: 'Incoming → manual → automations → campaigns',
  },
  orderIntegrationTitle: {
    es: 'Pedidos contra entrega',
    en: 'Cash-on-delivery orders',
  },
  orderIntegrationHint: {
    es: 'Actualiza pedidos confirmados y conecta Dropi.',
    en: 'Update confirmed orders and connect Dropi.',
  },
  capacityDedupeTitle: {
    es: 'Evitar llamadas duplicadas',
    en: 'Prevent duplicate calls',
  },
  capacityDedupeHint: {
    es: 'Agrupa disparos automáticos repetidos.',
    en: 'Groups repeated automatic triggers.',
  },
  capacityMinutes: { es: 'min', en: 'min' },
  capacityPriority: { es: 'Prioridad automática', en: 'Automatic priority' },
  capacityPriorityInbound: { es: 'Entrantes', en: 'Incoming' },
  capacityPriorityManual: { es: 'Manuales', en: 'Manual' },
  capacityPriorityAutomation: { es: 'Automatizaciones', en: 'Automations' },
  capacityPriorityCampaign: { es: 'Campañas', en: 'Campaigns' },
  capacitySaved: { es: 'Capacidad actualizada', en: 'Capacity updated' },
  capacitySaveFailed: {
    es: 'No se pudo guardar la capacidad.',
    en: "Couldn't save call capacity.",
  },
  agentOperations: { es: 'Operación', en: 'Operations' },
  agentOperationsHint: {
    es: 'Cómo atiende y cuándo pasa la llamada a una persona.',
    en: 'How it answers and when it hands the call to a person.',
  },
  agentAcceptsInbound: {
    es: 'Atender llamadas entrantes',
    en: 'Answer incoming calls',
  },
  agentAcceptsInboundHint: {
    es: 'Puede responder las llamadas que llegan a tu número.',
    en: 'Can answer calls placed to your number.',
  },
  agentTransferNumber: {
    es: 'Transferir a esta persona',
    en: 'Transfer to this person',
  },
  agentMaxDuration: {
    es: 'Duración máxima',
    en: 'Maximum duration',
  },
  durationThreeMinutes: { es: '3 minutos', en: '3 minutes' },
  durationFiveMinutes: { es: '5 minutos', en: '5 minutes' },
  durationTenMinutes: { es: '10 minutos', en: '10 minutes' },
  advancedToggle: { es: 'Opciones avanzadas', en: 'Advanced options' },

  // El freno de emergencia sale de la lista de interruptores: no es una
  // preferencia como grabar, es un botón de pánico y tiene que verse así.
  stopTitle: { es: 'Parar todas las llamadas', en: 'Stop all calls' },
  stopHint: {
    es: 'Corta al instante lo que salga y lo que entre. Se vuelve a encender aquí mismo.',
    en: 'Instantly cuts everything, outgoing and incoming. Turned back on right here.',
  },
  stopAction: { es: 'Parar todo', en: 'Stop everything' },
  stopped: { es: 'Llamadas paradas', en: 'Calls stopped' },
  stoppedResume: { es: 'Reanudar', en: 'Resume' },

  // Debajo del interruptor de voz del agente: los otros interruptores del
  // editor cambian cómo escribe; éste hace sonar teléfonos y cuesta plata.
  agentVoiceFacts: {
    es: 'Llama desde {number}, de {from} a {to}. Cerca de {cost} por llamada.',
    en: 'Calls from {number}, {from} to {to}. About {cost} per call.',
  },
  agentVoiceNoNumber: {
    es: 'Falta comprar un número en Llamadas para que pueda marcar.',
    en: 'A phone number is still missing, buy one under Calls.',
  },

  configure: { es: 'Configurar', en: 'Configure' },
  callLogTitle: { es: 'Registro de llamadas', en: 'Call log' },
  noCalls: { es: 'Todavía no hay llamadas.', en: 'No calls yet.' },
  noCallsMatch: {
    es: 'Ninguna llamada coincide con los filtros.',
    en: 'No calls match the filters.',
  },
  colContact: { es: 'Contacto', en: 'Contact' },
  colStatus: { es: 'Estado', en: 'Status' },
  colWhen: { es: 'Fecha', en: 'Date' },

  // ── Registro · filtros, paginado y exportación ──
  searchPlaceholder: { es: 'Nombre o teléfono', en: 'Name or phone' },
  filterAll: { es: 'todos', en: 'all' },
  clearFilters: { es: 'Limpiar filtros', en: 'Clear filters' },
  callType: { es: 'Tipo', en: 'Type' },
  direction: { es: 'Dirección', en: 'Direction' },
  agent: { es: 'Agente', en: 'Agent' },
  dateAnytime: { es: 'cualquiera', en: 'any' },
  dateLast7: { es: 'últimos 7 días', en: 'last 7 days' },
  dateLast30: { es: 'últimos 30 días', en: 'last 30 days' },
  dateLast90: { es: 'últimos 90 días', en: 'last 90 days' },
  typeOrderConfirmation: {
    es: 'Confirmación de pedido',
    en: 'Order confirmation',
  },
  typeCartRecovery: { es: 'Recuperación de carrito', en: 'Cart recovery' },
  typeFollowup: { es: 'Seguimiento', en: 'Follow-up' },
  typeManual: { es: 'Manual', en: 'Manual' },
  typeInbound: { es: 'Entrante', en: 'Inbound' },
  directionOutbound: { es: 'Saliente', en: 'Outgoing' },
  directionInbound: { es: 'Entrante', en: 'Incoming' },
  paginationRange: {
    es: '{from}–{to} de {total}',
    en: '{from}–{to} of {total}',
  },
  pageOf: { es: 'Página {page} de {total}', en: 'Page {page} of {total}' },
  perPage: { es: 'Por página:', en: 'Per page:' },
  exportCsv: { es: 'Exportar CSV', en: 'Export CSV' },
  exportFilename: { es: 'llamadas', en: 'calls' },
  exportDurationSeconds: { es: 'Duración (seg)', en: 'Duration (sec)' },
  exported: { es: '{count} llamadas exportadas', en: '{count} calls exported' },
  exportError: { es: 'No se pudo exportar', en: "Couldn't export" },
  exportTruncated: {
    es: 'Se exportaron las 5000 llamadas más recientes del filtro.',
    en: 'Exported the 5,000 most recent calls in the filter.',
  },

  // ── Admin · global model stack ──
  adminTitle: { es: 'Modelo de voz (global)', en: 'Voice model (global)' },
  /** Encabeza el resumen del stack que corre en las llamadas ahora mismo. */
  adminActive: { es: 'Activo', en: 'Active' },
  adminDesc: {
    es: 'Stack de modelos que usan TODAS las cuentas. Solo el equipo de Riverz lo cambia; los merchants no lo ven.',
    en: 'Model stack used by ALL accounts. Only the Riverz team changes it; merchants never see it.',
  },
  adminForbidden: {
    es: 'No tienes acceso a esta sección.',
    en: "You don't have access to this section.",
  },
  adminMode: { es: 'Modo de conversación', en: 'Conversation mode' },
  adminModePipeline: {
    es: 'Pipeline (STT → LLM → TTS)',
    en: 'Pipeline (STT → LLM → TTS)',
  },
  adminPipelineHint: {
    es: 'Máximo control y tool-calling fiable. Recomendado para pedidos/cobros.',
    en: 'Maximum control and reliable tool-calling. Recommended for orders/payments.',
  },
  adminModeRealtime: {
    es: 'Tiempo real (full-duplex)',
    en: 'Realtime (full-duplex)',
  },
  adminRealtimeHint: {
    es: 'Voz a voz nativa (ej. PersonaPlex): más fluida y humana. Requiere cablear el motor en el worker.',
    en: 'Native speech-to-speech (e.g. PersonaPlex): more fluid and human. Requires wiring the engine in the worker.',
  },
  adminStt: { es: 'Reconocimiento de voz (STT)', en: 'Speech-to-text (STT)' },
  adminLlm: { es: 'Cerebro (LLM)', en: 'Brain (LLM)' },
  adminTts: { es: 'Voz (TTS)', en: 'Text-to-speech (TTS)' },
  adminRealtime: { es: 'Motor full-duplex', en: 'Full-duplex engine' },
  adminProvider: { es: 'Proveedor', en: 'Provider' },
  adminModel: { es: 'Modelo', en: 'Model' },
  adminLanguage: { es: 'Idioma', en: 'Language' },
  adminDefaultVoice: { es: 'Voz por defecto', en: 'Default voice' },
  adminEndpoint: {
    es: 'Endpoint (Modal, opcional)',
    en: 'Endpoint (Modal, optional)',
  },
  adminEndpointHint: {
    es: 'URL OpenAI-compatible; vacío = proveedor por defecto',
    en: 'OpenAI-compatible URL; empty = default provider',
  },
  adminApiKey: { es: 'API key del endpoint', en: 'Endpoint API key' },
  adminKeyEnvHint: { es: 'usa la del servidor', en: 'uses server key' },
  adminKeyEnvNote: {
    es: 'Vacío = usa la variable de entorno del servidor para este proveedor.',
    en: 'Empty = uses the server environment variable for this provider.',
  },
  // Probar la llave. Nació de un día entero de teléfono roto con la clave
  // puesta y el proveedor sin saldo: el panel decía "configurada" y las
  // llamadas salían mudas. Configurada y funcionando no son lo mismo.
  adminTest: { es: 'Probar', en: 'Test' },
  adminTestAll: { es: 'Probar todo', en: 'Test all' },
  adminTesting: { es: 'Probando…', en: 'Testing…' },
  adminProbeOk: { es: 'Responde', en: 'Responding' },
  adminProbeNoKey: {
    es: 'Sin llave: ni aquí ni en el servidor',
    en: 'No key: neither here nor on the server',
  },
  adminProbeBadKey: { es: 'La llave no sirve', en: 'The key is not valid' },
  adminProbeNoCredit: {
    es: 'Sin saldo en el proveedor',
    en: 'No credit left with the provider',
  },
  adminProbeModelNotFound: {
    es: 'Ese modelo no existe en este proveedor',
    en: 'That model does not exist for this provider',
  },
  adminProbeRateLimited: { es: 'Frenado por cuota', en: 'Rate limited' },
  adminProbeUnreachable: { es: 'No se pudo llegar', en: 'Could not reach it' },
  adminProbeError: { es: 'Falló', en: 'Failed' },
  adminProbeHint: {
    es: 'Le pregunta al proveedor con la misma llave que usarían las llamadas.',
    en: 'Asks the provider with the same key the calls would use.',
  },
  adminSave: { es: 'Guardar', en: 'Save' },
  adminSaved: { es: 'Modelo actualizado', en: 'Model updated' },
  adminAutoFixed: {
    es: 'Ajustado para el proveedor nuevo',
    en: 'Adjusted for the new provider',
  },
  adminVoiceInModel: {
    es: 'Este proveedor elige la voz en el modelo.',
    en: 'This provider picks the voice in the model.',
  },
  adminVoiceInvalid: {
    es: 'Esta voz no es de este proveedor: al guardar se usará la suya.',
    en: "This voice isn't from this provider: saving will use its own.",
  },

  // ── COD mode (integrations · voice card) ──
  codMode: { es: 'Modo confirmación COD', en: 'COD confirmation mode' },
  codModeHint: {
    es: 'Para dropshipping / pago contra entrega. Activa escribir el resultado en el pedido y agrupar llamadas.',
    en: 'For dropshipping / cash on delivery. Enables writing the outcome to the order and grouping calls.',
  },
  orderWriteback: {
    es: 'Escribir resultado en el pedido (Shopify)',
    en: 'Write outcome to the order (Shopify)',
  },
  confirmedTag: { es: 'Etiqueta al confirmar', en: 'Tag when confirmed' },
  cancelledTag: { es: 'Etiqueta al cancelar', en: 'Tag when cancelled' },
  // ── Dropi integration card ──
  dropiDesc: {
    es: 'Fulfillment COD: los pedidos confirmados por llamada pasan a despacho.',
    en: 'COD fulfillment: orders confirmed by call go to dispatch.',
  },
  dropiApiKey: { es: 'API key de Dropi', en: 'Dropi API key' },
  dropiReplaceKey: { es: 'Reemplazar API key…', en: 'Replace API key…' },
  dropiBaseUrl: { es: 'URL base (opcional)', en: 'Base URL (optional)' },
  dropiInvalidKey: {
    es: 'Ingresa una API key válida.',
    en: 'Enter a valid API key.',
  },
  dropiConnected: { es: 'Dropi conectado', en: 'Dropi connected' },
  dropiDisconnected: { es: 'Dropi desconectado', en: 'Dropi disconnected' },
  dropiConnectError: {
    es: 'No se pudo conectar Dropi.',
    en: "Couldn't connect Dropi.",
  },

  // ── Upsell (agent · order confirmation) ──
  upsellLabel: {
    es: 'Ofrecer más unidades (upsell)',
    en: 'Offer more units (upsell)',
  },
  upsellOfferPlaceholder: {
    es: 'Ej: ofrece llevar 2 unidades con envío gratis.',
    en: 'E.g. offer to take 2 units with free shipping.',
  },
  upsellDiscountPlaceholder: {
    es: 'Descuento a mencionar (opcional)',
    en: 'Discount to mention (optional)',
  },

  // ── Voice campaigns ──
  campaignsTitle: { es: 'Campañas de voz', en: 'Voice campaigns' },
  campaignsHint: {
    es: 'Llama a un segmento de contactos con un objetivo. Respeta horario, opt-out y límites.',
    en: 'Call a segment of contacts with an objective. Respects hours, opt-out and limits.',
  },
  campaignName: { es: 'Nombre de la campaña', en: 'Campaign name' },
  campaignPickAgent: { es: 'Elige un agente…', en: 'Pick an agent…' },
  campaignPickSegment: { es: 'Elige un segmento…', en: 'Pick a segment…' },
  campaignObjective: { es: 'Objetivo de las llamadas', en: 'Call objective' },
  campaignSaveDraft: { es: 'Guardar borrador', en: 'Save draft' },
  campaignStart: { es: 'Iniciar', en: 'Start' },
  campaignMissing: {
    es: 'Completa nombre, agente y segmento.',
    en: 'Fill in name, agent and segment.',
  },
  campaignError: {
    es: 'No se pudo crear la campaña.',
    en: "Couldn't create the campaign.",
  },
  campaignStarted: { es: 'Campaña iniciada', en: 'Campaign started' },
  campaignSaved: { es: 'Campaña guardada', en: 'Campaign saved' },
  campaignStatusDraft: { es: 'Borrador', en: 'Draft' },
  campaignStatusRunning: { es: 'En curso', en: 'Running' },
  campaignStatusPaused: { es: 'Pausada', en: 'Paused' },
  campaignStatusDone: { es: 'Terminada', en: 'Finished' },
  campaignStatusCanceled: { es: 'Cancelada', en: 'Canceled' },
  campaignProgress: {
    es: '{done} de {total} llamadas',
    en: '{done} of {total} calls',
  },

  // ── Extra metrics ──
  metricsLast30: { es: 'últimos 30 días', en: 'last 30 days' },
  metricConfirmed: { es: 'Confirmadas', en: 'Confirmed' },
  metricUpsell: { es: 'Ingreso upsell', en: 'Upsell revenue' },
  metricByHour: { es: 'Por hora del día', en: 'By hour of day' },
  metricByCity: {
    es: 'Por ciudad (confirmadas/total)',
    en: 'By city (confirmed/total)',
  },
  metricByOutcome: { es: 'Por resultado', en: 'By outcome' },

  // ── Call detail (per-call drill-down) ──
  callDetail: { es: 'Detalle de la llamada', en: 'Call detail' },
  recording: { es: 'Grabación', en: 'Recording' },
  transcript: { es: 'Transcripción', en: 'Transcript' },
  roleAgent: { es: 'Agente', en: 'Agent' },
  roleCustomer: { es: 'Cliente', en: 'Customer' },
  attempt: { es: 'Intento', en: 'Attempt' },
  city: { es: 'Ciudad', en: 'City' },
  upsellAmount: { es: 'Upsell', en: 'Upsell' },
  openInInbox: { es: 'Ver en bandeja', en: 'View in inbox' },

  // ── Usage this month (voice card) ──

  // ── Per-objective extra instructions ──
  extraInstructions: {
    es: 'Instrucciones extra (opcional)',
    en: 'Extra instructions (optional)',
  },

  // ── Números self-serve (comprar por país) ──
  numberTitle: { es: 'Número de teléfono', en: 'Phone number' },
  numberDesc: {
    es: 'Compra el número propio de este espacio de trabajo.',
    en: "Buy this workspace's own number.",
  },
  // La frase que mas plata ahorra de todo el panel: medido en esta cuenta, un
  // +1 llamando a moviles colombianos casi no se contesta.
  numberPickCountry: {
    es: '¿En qué país están tus clientes?',
    en: 'Where are your customers?',
  },
  numberLocalWins: {
    es: 'Un número del país de tus clientes se contesta mucho más que uno extranjero.',
    en: "A number from your customers' country gets answered far more than a foreign one.",
  },
  numberOtherCountry: { es: 'Otro país…', en: 'Another country…' },
  numberOtherCountryHint: {
    es: 'Código de 2 letras (ej: PT, IT).',
    en: 'Two-letter code (e.g. PT, IT).',
  },
  numberSearching: { es: 'Buscando…', en: 'Searching…' },
  numberFoundType: {
    es: 'No hay números locales; estos son {type}.',
    en: 'No local numbers; these are {type}.',
  },
  numberMonthly: { es: '{amount} al mes', en: '{amount}/month' },
  numberFree: { es: 'Sin costo mensual', en: 'No monthly cost' },
  numberBuying: { es: 'Comprando…', en: 'Buying…' },
  // El papeleo: antes aparecia de golpe a mitad de la busqueda, como un muro
  // de campos sin explicacion.
  numberDocsCountry: {
    es: '{country} pide documentación para tener un número.',
    en: '{country} requires documentation to hold a number.',
  },
  numberDocsProgress: {
    es: '{done} de {total} listos',
    en: '{done} of {total} ready',
  },
  numberRegStatusDeclinedHint: {
    es: 'Revisa los datos y vuelve a enviarlos.',
    en: 'Check the details and submit again.',
  },

  numberCountry: { es: 'País', en: 'Country' },
  numberType: { es: 'Tipo', en: 'Type' },
  numberTypeLocal: { es: 'Local', en: 'Local' },
  numberTypeTollFree: { es: 'Gratuito (toll-free)', en: 'Toll-free' },
  numberTypeMobile: { es: 'Móvil', en: 'Mobile' },
  numberTypeNational: { es: 'Nacional', en: 'National' },
  numberSearch: { es: 'Buscar números', en: 'Search numbers' },
  numberNoResults: {
    es: 'Sin números disponibles para esos filtros.',
    en: 'No numbers available for those filters.',
  },
  numberBuy: { es: 'Comprar', en: 'Buy' },
  numberBought: { es: 'Número comprado', en: 'Number purchased' },
  numberBuyError: {
    es: 'No se pudo comprar el número.',
    en: "Couldn't buy the number.",
  },
  numberRelease: { es: 'Liberar número', en: 'Release number' },
  numberReleased: { es: 'Número liberado', en: 'Number released' },
  numberReleaseConfirm: {
    es: '¿Liberar el número? Se detiene la renta y dejará de recibir llamadas.',
    en: 'Release the number? The rental stops and it will no longer receive calls.',
  },
  numberPerMonth: { es: '/mes', en: '/mo' },
  numberDocsRequired: {
    es: 'Este país exige documentación para poder comprar el número:',
    en: 'This country requires documentation before buying the number:',
  },
  numberDocsHint: {
    es: 'Completa cada requisito y envíalo a revisión; podrás comprar cuando se apruebe.',
    en: 'Complete each requirement and submit for review; you can buy once approved.',
  },
  // Regulatory submission
  numberRegSubmit: { es: 'Enviar para aprobación', en: 'Submit for approval' },
  numberRegError: {
    es: 'No se pudo enviar la documentación.',
    en: "Couldn't submit the documentation.",
  },
  numberRegStatusPending: {
    es: 'Documentación en revisión',
    en: 'Documentation under review',
  },
  numberRegStatusApproved: {
    es: 'Documentación aprobada',
    en: 'Documentation approved',
  },
  numberRegStatusDeclined: {
    es: 'Documentación rechazada',
    en: 'Documentation declined',
  },
  numberRegPendingHint: {
    es: 'Telnyx la está revisando; vuelve más tarde para comprar.',
    en: 'Telnyx is reviewing it; come back later to buy.',
  },
  numberRegApprovedHint: {
    es: 'Ya puedes comprar el número.',
    en: 'You can now buy the number.',
  },
  numberUpload: { es: 'Subir archivo', en: 'Upload file' },
  numberUploading: { es: 'Cargando…', en: 'Uploading…' },
  numberUploaded: { es: 'Cargado', en: 'Uploaded' },
  // Address requirement fields
  numberAddrBusiness: { es: 'Empresa o nombre', en: 'Business or name' },
  numberAddrStreet: { es: 'Dirección', en: 'Street address' },
  numberAddrCity: { es: 'Ciudad', en: 'City' },
  numberAddrState: { es: 'Estado / Provincia', en: 'State / Province' },
  numberAddrPostal: { es: 'Código postal', en: 'Postal code' },
  numberAddrSave: { es: 'Guardar dirección', en: 'Save address' },
  numberAddrSaved: { es: 'Dirección guardada', en: 'Address saved' },
} satisfies Namespace;
