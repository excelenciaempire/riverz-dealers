import type { Namespace } from "./types";

/** Flows feature area: list, editor (canvas), simulator, variables,
 *  versions, runs/analytics, AI builder, command palette. */
export const flows = {
  // ── Flows list page (menus/page.tsx) ──
  newFlow: { es: "Nuevo flujo", en: "New flow" },
  loadFailed: { es: "No se pudieron cargar los flujos.", en: "Couldn't load flows." },
  createFailed: { es: "No se pudo crear el flujo.", en: "Couldn't create the flow." },
  useTemplateFailed: { es: "No se pudo usar la plantilla.", en: "Couldn't use the template." },
  confirmDelete: { es: '¿Eliminar "{name}"?', en: 'Delete "{name}"?' },
  deleted: { es: "Eliminado.", en: "Deleted." },
  deleteRowFailed: { es: "No se pudo eliminar.", en: "Couldn't delete." },
  flowActivated: { es: "Flujo activado", en: "Flow activated" },
  flowPaused: { es: "Flujo pausado", en: "Flow paused" },
  statusChangeFailed: { es: "No se pudo cambiar el estado", en: "Couldn't change the status" },

  createTitleChoose: { es: "¿Cómo quieres empezar?", en: "How do you want to start?" },
  createTitleName: { es: "Nombre del flujo", en: "Flow name" },
  createTitleTemplate: { es: "Elige una plantilla", en: "Choose a template" },
  createTitlePreview: { es: "Vista previa", en: "Preview" },
  back: { es: "Volver", en: "Back" },

  choiceTemplateTitle: { es: "Usar una plantilla", en: "Use a template" },
  choiceTemplateDesc: {
    es: "Empiezas con un flujo de ejemplo y lo editas.",
    en: "Start from an example flow and edit it.",
  },
  recommended: { es: "Recomendado", en: "Recommended" },
  choiceBlankTitle: { es: "Empezar en blanco", en: "Start from scratch" },
  choiceBlankDesc: {
    es: "Lienzo en blanco. Tú armas cada paso desde cero.",
    en: "Blank canvas. Build every step yourself.",
  },

  namePlaceholder: { es: "Ej: Flujo de bienvenida", en: "e.g. Welcome flow" },
  createBlankFlow: { es: "Crear flujo vacío", en: "Create empty flow" },
  noTemplates: { es: "Todavía no hay plantillas disponibles.", en: "No templates available yet." },
  stepsCount: { es: "{n} pasos", en: "{n} steps" },
  view: { es: "Ver", en: "View" },
  useTemplate: { es: "Usar plantilla", en: "Use template" },

  // Node-type labels in template preview outline
  nodeMessage: { es: "Mensaje", en: "Message" },
  nodeButtons: { es: "Botones", en: "Buttons" },
  nodeList: { es: "Lista", en: "List" },
  nodeCtaUrl: { es: "Botón con enlace", en: "Link button" },
  nodeQuestion: { es: "Pregunta", en: "Question" },
  nodeShopify: { es: "Shopify", en: "Shopify" },
  nodeAi: { es: "IA", en: "AI" },
  nodeHandoffToHuman: { es: "A un humano", en: "To a human" },
  nodeEnd: { es: "Fin", en: "End" },

  summaryOpen: { es: "Abrir", en: "Open" },
  summaryShopifyLookup: { es: "Busca el pedido en Shopify.", en: "Looks up the order in Shopify." },
  summaryAiRoute: { es: "(la IA enruta la respuesta)", en: "(AI routes the reply)" },
  summaryHandoff: { es: "Pasa la conversación a una persona.", en: "Hands the conversation to a person." },
  summaryEnd: { es: "Fin del flujo.", en: "End of flow." },

  trigger: { es: "Disparador", en: "Trigger" },
  flowStart: { es: "Inicio del flujo", en: "Flow start" },

  emptyTitle: { es: "Sin flujos todavía", en: "No flows yet" },
  emptyDescription: {
    es: "Un flujo guía al cliente con botones: toca una opción y avanza al siguiente paso, sin IA. Empieza con una plantilla o créalo desde cero.",
    en: "A flow guides the customer with buttons: they tap an option and move to the next step, no AI. Start from a template or build it from scratch.",
  },
  createFirstFlow: { es: "Crear mi primer flujo", en: "Create my first flow" },

  statusDraft: { es: "Borrador", en: "Draft" },
  statusActive: { es: "Activo", en: "Active" },
  statusArchived: { es: "Archivado", en: "Archived" },
  pauseFlow: { es: "Pausar flujo", en: "Pause flow" },
  activateFlow: { es: "Activar flujo", en: "Activate flow" },
  archived: { es: "Archivado", en: "Archived" },
  timesUsedOne: { es: "vez usado", en: "time used" },
  timesUsedMany: { es: "veces usado", en: "times used" },
  edit: { es: "Editar", en: "Edit" },
  delete: { es: "Eliminar", en: "Delete" },

  triggerKeywordNone: {
    es: "Se activa cuando el cliente escribe una palabra clave (ninguna definida)",
    en: "Triggers when the customer types a keyword (none defined)",
  },
  triggerKeywordWith: { es: "Se activa con: {keywords}", en: "Triggers on: {keywords}" },
  triggerFirstMessage: {
    es: "Se activa con el primer mensaje del cliente",
    en: "Triggers on the customer's first message",
  },
  triggerManual: { es: "Lo activas tú a mano", en: "You trigger it manually" },

  // ── Flows layout (menus/layout.tsx) ──
  connectChannelTitle: {
    es: "Conecta un canal antes de crear flujos",
    en: "Connect a channel before building flows",
  },
  connectChannelDesc: {
    es: "Necesitas un canal oficial conectado para enviar mensajes.",
    en: "You need an official channel connected to send messages.",
  },

  // ── New from template page (menus/nueva/page.tsx) ──
  templateNotFound: { es: "Plantilla no encontrada.", en: "Template not found." },
  backToFlows: { es: "Volver a flujos", en: "Back to flows" },

  // ── Flow editor page (menus/[id]/page.tsx) ──
  flowLoadFailed: { es: "No se pudo cargar el flujo.", en: "Couldn't load the flow." },
  flowNotFound: { es: "Flujo no encontrado.", en: "Flow not found." },
  backToFlowsArrow: { es: "← Volver a flujos", en: "← Back to flows" },

  // ── Runs / analytics page (menus/[id]/usos/page.tsx) ──
  runStatusActive: { es: "Activo", en: "Active" },
  runStatusCompleted: { es: "Completado", en: "Completed" },
  runStatusHandedOff: { es: "Transferido", en: "Handed off" },
  runStatusTimedOut: { es: "Expirado", en: "Timed out" },
  runStatusPaused: { es: "Pausado", en: "Paused" },
  runStatusFailed: { es: "Fallido", en: "Failed" },

  usagePerDay: { es: "Usos por día", en: "Usage per day" },
  lastNDays: { es: "Últimos {n} días.", en: "Last {n} days." },
  howTheyEnded: { es: "Cómo terminaron", en: "How they ended" },
  breakdownByStatus: { es: "Reparto por estado del último corte.", en: "Breakdown by status for the latest period." },

  runsLoadFailed: { es: "No se pudieron cargar los usos.", en: "Couldn't load usage data." },
  menuNotFound: { es: "Menú no encontrado.", en: "Menu not found." },
  backToEditor: { es: "Volver al editor del menú", en: "Back to the menu editor" },
  menuLabel: { es: "Menú", en: "Menu" },
  usesTitle: { es: "Usos", en: "Usage" },

  emptyRunsTitle: { es: "Este menú aún no se ha usado", en: "This menu hasn't been used yet" },
  emptyRunsDesc: {
    es: "Aquí verás cada conversación cuando un cliente lo ejecute.",
    en: "You'll see each conversation here once a customer runs it.",
  },

  metricTotalRuns: { es: "Usos totales", en: "Total runs" },
  metricActive: { es: "Activos", en: "Active" },
  metricCompleted: { es: "Completados", en: "Completed" },
  metricHandedOff: { es: "Transferidos", en: "Handed off" },
  metricAvgDuration: { es: "Duración prom.", en: "Avg. duration" },

  conversations: { es: "Conversaciones", en: "Conversations" },
  ofTotal: { es: " de {total}", en: " of {total}" },
  searchContact: { es: "Buscar contacto…", en: "Search contact…" },
  allStatuses: { es: "Todos", en: "All" },
  allStatusesItem: { es: "Todos los estados", en: "All statuses" },
  noResults: { es: "Sin resultados.", en: "No results." },

  unknownContact: { es: "Contacto desconocido", en: "Unknown contact" },
  retriesCount: { es: "· {n} reintentos", en: "· {n} retries" },
  lastedFor: { es: "· duró {duration}", en: "· lasted {duration}" },
  capturedData: { es: "Datos capturados ({n})", en: "Captured data ({n})" },
  noEventsLogged: { es: "Sin eventos registrados.", en: "No events logged." },

  eventStarted: { es: "Conversación iniciada", en: "Conversation started" },
  eventNodeEntered: { es: "Entró al paso", en: "Entered step" },
  eventMessageSent: { es: "Mensaje enviado", en: "Message sent" },
  eventReplyReceived: { es: "Respuesta recibida", en: "Reply received" },
  eventFallbackFired: { es: "Alternativa activada", en: "Fallback fired" },
  eventHandoff: { es: "Pasó a un humano", en: "Handed off to a human" },
  eventTimeout: { es: "Sin actividad", en: "No activity" },
  eventError: { es: "Error", en: "Error" },
  eventCompleted: { es: "Conversación terminada", en: "Conversation ended" },

  // ── AI builder panel (ai-builder-panel.tsx) ──
  couldNotConnect: { es: "No se pudo conectar", en: "Couldn't connect" },
  couldNotProcess: { es: "No pude procesar eso: {msg}", en: "Couldn't process that: {msg}" },
  openAiBuilder: { es: "Abrir constructor IA", en: "Open AI builder" },
  aiBuilder: { es: "Constructor IA", en: "AI builder" },
  aiBuilderSubtitle: {
    es: "Edita el flujo en lenguaje natural",
    en: "Edit the flow in plain language",
  },
  close: { es: "Cerrar", en: "Close" },
  thinking: { es: "Pensando…", en: "Thinking…" },
  aiInputPlaceholder: { es: "¿Qué quieres armar?", en: "What do you want to build?" },
  send: { es: "Enviar", en: "Send" },
  oneChangeApplied: { es: "1 cambio aplicado", en: "1 change applied" },
  changesApplied: { es: "{n} cambios aplicados", en: "{n} changes applied" },
  someIdeas: { es: "Algunas ideas para tu flujo:", en: "Some ideas for your flow:" },
  aiBuilderFooter: {
    es: "Los cambios se aplican al lienzo, pero NO se guardan hasta que pulses Guardar arriba. Ctrl+Z reverte el último turno.",
    en: "Changes apply to the canvas but are NOT saved until you press Save above. Ctrl+Z reverts the last turn.",
  },
  suggestWelcomeMenu: {
    es: "Arma un menú de bienvenida con tres botones: Comprar, Soporte, Estado de mi pedido.",
    en: "Build a welcome menu with three buttons: Buy, Support, My order status.",
  },
  suggestOfferFeatured: {
    es: "Manda un mensaje que ofrezca {product} con un botón que abra el link de la tienda.",
    en: "Send a message offering {product} with a button that opens the store link.",
  },
  suggestAskAndRoute: {
    es: "Pregunta al cliente qué necesita y deriva según su respuesta con IA.",
    en: "Ask the customer what they need and route by their reply using AI.",
  },
  suggestShippingReturns: {
    es: "Configura un flujo para responder dudas de envío y devoluciones.",
    en: "Set up a flow to answer shipping and returns questions.",
  },
  suggestWaitAndRoute: {
    es: "Después del primer mensaje, espera la respuesta del cliente y deriva con IA según lo que diga.",
    en: "After the first message, wait for the customer's reply and route with AI based on what they say.",
  },
  suggestAddButtons: {
    es: "Agrega un paso con botones para que el cliente elija entre Comprar o Soporte.",
    en: "Add a buttons step so the customer can choose between Buy or Support.",
  },
  suggestEndWithLink: {
    es: "Termina el flujo con un botón que mande el link de {product}.",
    en: "End the flow with a button that sends the {product} link.",
  },
  suggestEndWithHandoff: {
    es: "Termina el flujo derivando a un humano cuando el cliente pida ayuda.",
    en: "End the flow by handing off to a human when the customer asks for help.",
  },
  suggestConnectLoose: {
    es: "Revisa los pasos sueltos y conéctalos al flujo principal.",
    en: "Review the loose steps and connect them to the main flow.",
  },
  suggestAddShopify: {
    es: "Agrega un paso de Buscar en Shopify para mostrar el estado del pedido cuando el cliente lo pida.",
    en: "Add a Look up in Shopify step to show the order status when the customer asks.",
  },
  suggestRecommendFeatured: {
    es: "Suma una rama que recomiende {product} cuando el cliente pregunte por novedades.",
    en: "Add a branch that recommends {product} when the customer asks what's new.",
  },
  suggestPolishCopy: {
    es: "Ajusta los textos para que suenen más cercanos y naturales.",
    en: "Polish the copy so it sounds warmer and more natural.",
  },

  // ── Command palette (command-palette.tsx) ──
  palettePlaceholder: {
    es: "Buscar paso, agregar tipo o acción",
    en: "Search a step, add a type, or run an action",
  },
  esc: { es: "Esc", en: "Esc" },
  paletteNoResults: { es: "Sin resultados para “{query}”.", en: "No results for “{query}”." },
  paletteNavHint: { es: "↑↓ navega · Enter ejecuta", en: "↑↓ navigate · Enter runs" },
  paletteOpenHint: { es: "Cmd+K abre", en: "Cmd+K opens" },

  // ── Simulator panel (simulator-panel.tsx) ──
  simNoEntry: {
    es: "El flujo no tiene un paso de entrada definido. Marca uno y vuelve a intentar.",
    en: "The flow has no entry step defined. Set one and try again.",
  },
  simButtonFallback: { es: "Botón", en: "Button" },
  simOptionFallback: { es: "Opción", en: "Option" },
  simCtaFallback: { es: "Ver más", en: "Learn more" },
  simAttachment: { es: "Adjunto", en: "Attachment" },
  simStepNotFound: {
    es: 'Paso "{key}" no encontrado. El flujo termina aquí.',
    en: 'Step "{key}" not found. The flow ends here.',
  },
  simWaitingCustomer: { es: "Esperando respuesta del cliente.", en: "Waiting for the customer's reply." },
  simConditionEvaluated: {
    es: "Condición evaluada: {subject} {operator} {value} → {result}",
    en: "Condition evaluated: {subject} {operator} {value} → {result}",
  },
  simYes: { es: "Sí", en: "Yes" },
  simNo: { es: "No", en: "No" },
  simTagSet: { es: "Asigna etiqueta {tag}", en: "Adds tag {tag}" },
  simTagRemove: { es: "Quita etiqueta {tag}", en: "Removes tag {tag}" },
  simWait: {
    es: "Espera {amount} {unit} (simulado, sin pausa real).",
    en: "Waits {amount} {unit} (simulated, no real pause).",
  },
  simWaitDefaultUnit: { es: "minutos", en: "minutes" },
  simShopifyLookup: {
    es: "Buscar en Shopify ({kind}) — simulado como encontrado. Vars: {prefix}_*",
    en: "Look up in Shopify ({kind}) — simulated as found. Vars: {prefix}_*",
  },
  simAiFallback: {
    es: "IA: se necesita una respuesta para clasificar. Sim usa fallback.",
    en: "AI: a reply is needed to classify. Sim uses the fallback.",
  },
  simSubflow: {
    es: "Subflujo invocado ({id}). El simulador no carga los nodos del subflujo todavía; se continúa al siguiente paso del padre.",
    en: "Subflow invoked ({id}). The simulator doesn't load the subflow's nodes yet; it continues to the parent's next step.",
  },
  simSubflowNoId: { es: "sin id", en: "no id" },
  simHandoff: { es: "Se pasa al equipo humano. Fin de la simulación.", en: "Handed off to the team. End of simulation." },
  simEnd: { es: "Fin del flujo.", en: "End of flow." },
  simLoop: {
    es: "Posible bucle: el flujo recorrió {max} pasos sin pausa. Revísalo.",
    en: "Possible loop: the flow ran {max} steps without pausing. Review it.",
  },
  restart: { es: "Reiniciar", en: "Restart" },
  restartSim: { es: "Reiniciar simulación", en: "Restart simulation" },
  simulator: { es: "Simulador", en: "Simulator" },
  yourStore: { es: "Tu tienda", en: "Your store" },
  online: { es: "en línea", en: "online" },
  simStartPrompt: {
    es: 'Toca "Iniciar" para correr el flujo desde el inicio.',
    en: 'Tap "Start" to run the flow from the beginning.',
  },
  start: { es: "Iniciar", en: "Start" },
  simRealTriggerKeyword: { es: "Disparador real: keyword {keywords}", en: "Real trigger: keyword {keywords}" },
  simMessagePlaceholder: { es: "Mensaje", en: "Message" },
  waitingBot: { es: "Esperando bot…", en: "Waiting for bot…" },
  capturedVariables: { es: "Variables capturadas", en: "Captured variables" },

  // ── Variables panel (variables-panel.tsx) ──
  varCopied: { es: "{expr} copiado", en: "{expr} copied" },
  copyFailed: { es: "No se pudo copiar", en: "Couldn't copy" },
  viewAvailableVariables: { es: "Ver variables disponibles", en: "View available variables" },
  variables: { es: "Variables", en: "Variables" },
  flowVariables: { es: "Variables del flujo", en: "Flow variables" },
  variablesHint: {
    es: "Toca una para copiarla al portapapeles. Pégala en cualquier texto del nodo donde la necesites.",
    en: "Tap one to copy it to your clipboard. Paste it into any node text where you need it.",
  },
  noVariablesYet: {
    es: "Todavía no hay variables. Agrega un nodo de Recolectar dato o de Buscar en Shopify para empezar.",
    en: "No variables yet. Add a Collect input or Look up in Shopify step to get started.",
  },
  varCategoryCustomer: { es: "Cliente", en: "Customer" },
  varCategoryCollected: { es: "Datos recolectados", en: "Collected data" },
  varCategoryShopify: { es: "Resultados de Shopify", en: "Shopify results" },
  varCustomerName: { es: "Nombre del contacto", en: "Contact name" },
  varCustomerPhone: { es: "Teléfono del contacto", en: "Contact phone" },
  varCustomerEmail: { es: "Correo del contacto", en: "Contact email" },
  varNode: { es: "Nodo {key}", en: "Node {key}" },
  varProductOf: { es: "Producto de {key}", en: "Product from {key}" },
  varOrderOf: { es: "Pedido de {key}", en: "Order from {key}" },

  // ── Versions dialog (versions-dialog.tsx) ──
  versionsLoadFailed: { es: "No se pudo cargar el historial", en: "Couldn't load the history" },
  genericError: { es: "Error", en: "Error" },
  restoreFailed: { es: "No se pudo restaurar", en: "Couldn't restore" },
  versionRestored: { es: "Versión restaurada", en: "Version restored" },
  flowVersions: { es: "Versiones del flujo", en: "Flow versions" },
  versionsDescription: {
    es: "Cada vez que guardas se snapshotea un borrador, y cada vez que activas el flujo se snapshotea la versión publicada. Puedes restaurar a cualquier punto.",
    en: "Every save snapshots a draft, and every activation snapshots the published version. You can restore to any point.",
  },
  noVersionsYet: {
    es: "Todavía no hay historial. Guarda o activa el flujo para empezar a generar versiones.",
    en: "No history yet. Save or activate the flow to start creating versions.",
  },
  versionPublished: { es: "Publicado", en: "Published" },
  versionDraft: { es: "Borrador", en: "Draft" },
  restore: { es: "Restaurar", en: "Restore" },

  // ── WhatsApp bubble preview (whatsapp-bubble-preview.tsx) ──
  captionPlaceholder: { es: "Caption (opcional)…", en: "Caption (optional)…" },
  writeMessagePlaceholder: { es: "Escribe el mensaje…", en: "Write the message…" },
  emptyMessage: { es: "(mensaje vacío)", en: "(empty message)" },
  viewOptions: { es: "Ver opciones", en: "View options" },
  addButton: { es: "Agregar botón", en: "Add button" },
  maxThreeButtons: { es: "WhatsApp permite máximo 3 botones.", en: "WhatsApp allows up to 3 buttons." },
  buttonPlaceholder: { es: "Botón…", en: "Button…" },
  buttonFallback: { es: "Botón", en: "Button" },
  urlLabel: { es: "URL:", en: "URL:" },
  optionPlaceholder: { es: "Opción {n}", en: "Option {n}" },
  optionFallback: { es: "Opción", en: "Option" },
  listSectionDefault: { es: "Opciones", en: "Options" },
  descriptionOptional: { es: "Descripción (opcional)", en: "Description (optional)" },
  removeRow: { es: "Quitar fila", en: "Remove row" },
  addRow: { es: "Agregar fila", en: "Add row" },
  moreRows: { es: "+ {n} más…", en: "+ {n} more…" },
  filenamePlaceholder: { es: "archivo.pdf", en: "file.pdf" },
  removeButton: { es: "Quitar botón", en: "Remove button" },
  portConnected: { es: "Conexión existente", en: "Existing connection" },
  portConnect: { es: "Conectar a otro paso", en: "Connect to another step" },

  // ── Flow builder (flow-builder.tsx) ──
  // Node meta labels
  metaStart: { es: "Inicio", en: "Start" },
  metaSendMessage: { es: "Enviar mensaje", en: "Send message" },
  metaSendButtons: { es: "Enviar botones", en: "Send buttons" },
  metaSendList: { es: "Enviar lista", en: "Send list" },
  metaCollectInput: { es: "Pedir un dato al cliente", en: "Ask the customer for info" },
  metaCondition: { es: "Si / Si no", en: "If / Else" },
  metaSetTag: { es: "Etiquetar al cliente", en: "Tag the customer" },
  metaHandoff: { es: "Pasar a un humano", en: "Hand off to a human" },
  metaSendImage: { es: "Enviar imagen", en: "Send image" },
  metaSendVideo: { es: "Enviar video", en: "Send video" },
  metaSendDocument: { es: "Enviar documento", en: "Send document" },
  metaSendCtaUrl: { es: "Botón con enlace", en: "Link button" },
  metaWait: { es: "Esperar", en: "Wait" },
  metaAiIntent: { es: "Entender con IA", en: "Understand with AI" },
  metaShopifyLookup: { es: "Buscar en Shopify", en: "Look up in Shopify" },
  metaCustomerReply: { es: "Cliente responde", en: "Customer replies" },
  metaSubflow: { es: "Subflujo", en: "Subflow" },
  metaEnd: { es: "Fin", en: "End" },

  // summarizeNode strings
  sumOptionsOne: { es: "opción", en: "option" },
  sumOptionsMany: { es: "opciones", en: "options" },
  sumSectionsOne: { es: "sección", en: "section" },
  sumSectionsMany: { es: "secciones", en: "sections" },
  sumOptionsInSections: {
    es: "{rows} {optionsLabel} en {sections} {sectionsLabel}",
    en: "{rows} {optionsLabel} in {sections} {sectionsLabel}",
  },
  sumHasTag: { es: "tiene etiqueta {tag}", en: "has tag {tag}" },
  sumOpContains: { es: "contiene", en: "contains" },
  sumOpNotContains: { es: "no contiene", en: "doesn't contain" },
  sumOpRegex: { es: "regex", en: "regex" },
  sumOpPresent: { es: "existe", en: "exists" },
  sumOpAbsent: { es: "no existe", en: "doesn't exist" },
  sumTagAdd: { es: "Añadir", en: "Add" },
  sumTagRemove: { es: "Quitar", en: "Remove" },
  sumTagWithId: { es: "{mode} etiqueta {id}…", en: "{mode} tag {id}…" },
  sumTagNone: { es: "{mode} etiqueta (ninguna elegida)", en: "{mode} tag (none chosen)" },
  sumIntentsOne: { es: "1 intención", en: "1 intent" },
  sumIntentsMany: { es: "{n} intenciones", en: "{n} intents" },
  sumCustomerReply: { es: "Esperando respuesta del cliente", en: "Waiting for the customer's reply" },
  sumSubflowWithId: { es: "Subflujo {id}…", en: "Subflow {id}…" },
  sumSubflowNone: { es: "Sin flujo elegido", en: "No flow chosen" },

  // defaultConfig defaults
  defaultButtonYes: { es: "Sí", en: "Yes" },
  defaultListButton: { es: "Ver opciones", en: "View options" },
  defaultOptionOne: { es: "Opción 1", en: "Option 1" },
  defaultCtaButton: { es: "Ver más", en: "Learn more" },
  defaultIntentYesDesc: { es: "El cliente acepta", en: "The customer accepts" },
  defaultIntentNoDesc: { es: "El cliente rechaza", en: "The customer declines" },

  // Save / status / delete toasts
  missingTemplate: { es: "Falta la plantilla.", en: "Template is missing." },
  templateAdded: { es: "Plantilla agregada.", en: "Template added." },
  saved: { es: "Guardado.", en: "Saved." },
  couldNotSave: { es: "No se pudo guardar", en: "Couldn't save" },
  fixErrorsBeforeActivating: { es: "Corrige los errores antes de activar.", en: "Fix the errors before activating." },
  activatedToast: { es: "Activado.", en: "Activated." },
  archivedToast: { es: "Archivado.", en: "Archived." },
  draftToast: { es: "Borrador.", en: "Draft." },
  couldNotUpdateStatus: { es: "No se pudo actualizar el estado", en: "Couldn't update the status" },
  couldNotDelete: { es: "No se pudo eliminar", en: "Couldn't delete" },
  nodesReordered: { es: "Nodos reordenados", en: "Steps reordered" },
  stepDeleted: { es: "Paso eliminado", en: "Step deleted" },
  stepsDeleted: { es: "{n} pasos eliminados", en: "{n} steps deleted" },
  stepCopied: { es: "Paso copiado", en: "Step copied" },
  stepsCopied: { es: "{n} pasos copiados", en: "{n} steps copied" },
  stepPasted: { es: "Paso pegado", en: "Step pasted" },
  stepsPasted: { es: "{n} pasos pegados", en: "{n} steps pasted" },
  useTemplateFailedShort: { es: "No se pudo usar la plantilla ({status})", en: "Couldn't use the template ({status})" },

  // Template preview banner
  templatePreviewBanner: {
    es: "Vista previa de la plantilla. Toca {action} para crearla y editarla.",
    en: "Template preview. Tap {action} to create it and edit it.",
  },

  // Command items
  cmdGroupAction: { es: "Acción", en: "Action" },
  cmdSave: { es: "Guardar", en: "Save" },
  cmdSaveHint: { es: "Aplica los cambios y revisa la validación.", en: "Apply changes and check validation." },
  cmdAutoLayout: { es: "Auto-organizar nodos", en: "Auto-arrange steps" },
  cmdAutoLayoutHint: { es: "Reordena el grafo en columnas según el flujo.", en: "Re-orders the graph into columns by flow." },
  cmdFitToView: { es: "Centrar todo el flujo", en: "Fit the whole flow" },
  cmdFitToViewHint: { es: "Encuadra todos los pasos en pantalla.", en: "Frames every step on screen." },
  cmdGroupJump: { es: "Saltar a paso", en: "Jump to step" },
  cmdStepFallback: { es: "Paso {key}", en: "Step {key}" },
  cmdGroupAdd: { es: "Agregar paso", en: "Add step" },
  cmdAddHint: { es: "Crea un nuevo {label}.", en: "Creates a new {label}." },

  // Header
  backToFlowsAria: { es: "Volver a flujos", en: "Back to flows" },
  flowNamePlaceholder: { es: "Nombre del flujo", en: "Flow name" },
  unsavedChanges: { es: "Cambios sin guardar", en: "Unsaved changes" },
  undoTitle: { es: "Deshacer (Ctrl+Z)", en: "Undo (Ctrl+Z)" },
  undo: { es: "Deshacer", en: "Undo" },
  redoTitle: { es: "Rehacer (Ctrl+Shift+Z)", en: "Redo (Ctrl+Shift+Z)" },
  redo: { es: "Rehacer", en: "Redo" },
  flowActiveTooltip: { es: "El flujo está activo. Toca para pausar.", en: "The flow is active. Tap to pause." },
  flowPausedTooltip: { es: "El flujo está pausado. Toca para activar.", en: "The flow is paused. Tap to activate." },
  fixErrorsTooltip: { es: "Corrige los errores antes de activar", en: "Fix the errors before activating" },
  pause: { es: "Pausar", en: "Pause" },
  activate: { es: "Activar", en: "Activate" },
  changing: { es: "Cambiando…", en: "Changing…" },
  headerActive: { es: "Activo", en: "Active" },
  headerPaused: { es: "Pausado", en: "Paused" },
  testAsCustomer: { es: "Probar el flujo como cliente", en: "Test the flow as a customer" },
  test: { es: "Probar", en: "Test" },
  save: { es: "Guardar", en: "Save" },
  moreOptions: { es: "Más opciones", en: "More options" },
  runs: { es: "Ejecuciones", en: "Runs" },
  versions: { es: "Versiones", en: "Versions" },
  hideAnalytics: { es: "Ocultar analítica", en: "Hide analytics" },
  showAnalytics: { es: "Mostrar analítica por nodo", en: "Show per-step analytics" },
  deleteFlow: { es: "Eliminar flujo", en: "Delete flow" },

  // Note editor
  nodeNote: { es: "Nota del nodo", en: "Step note" },
  notePlaceholder: {
    es: "Nota interna. No se envía al cliente. Sirve para coordinar con tu equipo.",
    en: "Internal note. It isn't sent to the customer. Use it to coordinate with your team.",
  },
  cmdEnterSaves: { es: "Cmd+Enter guarda", en: "Cmd+Enter saves" },
  cancel: { es: "Cancelar", en: "Cancel" },
  editNote: { es: "Editar nota", en: "Edit note" },
  addNote: { es: "Agregar nota", en: "Add note" },
  duplicateNode: { es: "Duplicar nodo", en: "Duplicate step" },
  duplicate: { es: "Duplicar", en: "Duplicate" },
  deleteNode: { es: "Eliminar nodo", en: "Delete step" },

  // Logic node body
  labelValue: { es: "Valor", en: "Value" },
  comparePlaceholder: { es: "Texto a comparar…", en: "Text to compare…" },
  labelTime: { es: "Tiempo", en: "Time" },
  labelInternalNote: { es: "Nota interna", en: "Internal note" },
  handoffNotePlaceholder: { es: "Por qué se pasa a un humano…", en: "Why it hands off to a human…" },
  setTagRemoveDesc: { es: "Quita la etiqueta.", en: "Removes the tag." },
  setTagAddDesc: { es: "Agrega la etiqueta.", en: "Adds the tag." },
  endNodeDesc: { es: "Fin del flujo. El cliente sale acá.", en: "End of flow. The customer exits here." },
  startNodeDesc: { es: "Punto de inicio.", en: "Starting point." },
  customerReplyDesc: {
    es: "El flujo se pausa hasta que el cliente envíe un mensaje. No se guarda nada — solo se espera.",
    en: "The flow pauses until the customer sends a message. Nothing is saved — it just waits.",
  },

  // Logic outputs
  outYes: { es: "Sí", en: "Yes" },
  outNo: { es: "No", en: "No" },
  outFound: { es: "Encontrado", en: "Found" },
  outNotFound: { es: "No encontrado", en: "Not found" },
  outNext: { es: "Avanza a", en: "Goes to" },

  // Quick add
  addNext: { es: "Agregar el siguiente paso", en: "Add the next step" },
  add: { es: "Agregar", en: "Add" },
  nextStep: { es: "Siguiente paso", en: "Next step" },

  // Shopify lookup form
  whatToLookUp: { es: "Qué buscar", en: "What to look up" },
  shopifyOrderByNumber: { es: "Pedido por número", en: "Order by number" },
  shopifyOrderByEmail: { es: "Pedido por correo", en: "Order by email" },
  shopifyLastOrder: { es: "Último pedido del contacto", en: "Contact's last order" },
  shopifyProductByHandle: { es: "Producto por handle", en: "Product by handle" },
  shopifyAutoInput: {
    es: "El número, correo o handle se toma automáticamente del último dato que el cliente compartió en el chat. Las variables del resultado (total, tracking, etc.) están en el panel Variables.",
    en: "The number, email, or handle is taken automatically from the last detail the customer shared in chat. The result variables (total, tracking, etc.) live in the Variables panel.",
  },

  // Subflow picker
  flowToRun: { es: "Flujo a ejecutar", en: "Flow to run" },
  loadingEllipsis: { es: "Cargando…", en: "Loading…" },
  chooseAFlow: { es: "Elegir un flujo", en: "Choose a flow" },
  subflowNote: {
    es: "Hoy el subflujo se registra como evento y pasa al siguiente paso directamente. La ejecución completa del subflujo llega en una actualización aparte.",
    en: "For now the subflow is logged as an event and continues straight to the next step. Full subflow execution arrives in a separate update.",
  },

  // NodeConfigForm field labels
  goesTo: { es: "Avanza a", en: "Goes to" },
  textSentToCustomer: { es: "Texto enviado al cliente", en: "Text sent to the customer" },
  messageSentToCustomer: { es: "Mensaje que se envía al cliente", en: "Message sent to the customer" },
  variableKey: { es: "Clave de variable", en: "Variable key" },
  varKeyPlaceholder: { es: "nombre", en: "name" },
  afterCaptureGoesTo: { es: "Tras capturar, avanza a", en: "After capturing, goes to" },
  handoffNoteLabel: {
    es: "Nota interna (para el agente que retome la conversación)",
    en: "Internal note (for the agent who picks up the conversation)",
  },
  fileUrlLabel: { es: "URL del archivo (https)", en: "File URL (https)" },
  filenameSeenLabel: { es: "Nombre que ve el cliente", en: "Name the customer sees" },
  captionLabel: { es: "Pie / descripción (opcional)", en: "Caption / description (optional)" },
  ctaMessageText: { es: "Texto del mensaje", en: "Message text" },
  ctaButtonLabel: { es: "Texto del botón (≤ 20 caracteres)", en: "Button text (≤ 20 characters)" },
  ctaUrlLabel: { es: "URL a abrir (https)", en: "URL to open (https)" },
  amount: { es: "Cantidad", en: "Amount" },
  unit: { es: "Unidad", en: "Unit" },
  unitMinutes: { es: "Minutos", en: "Minutes" },
  unitHours: { es: "Horas", en: "Hours" },
  unitDays: { es: "Días", en: "Days" },
  afterWaitGoesTo: { es: "Después de la espera, avanza a", en: "After the wait, goes to" },
  inputVarLabel: {
    es: 'Variable de entrada (de un nodo "Capturar entrada" previo)',
    en: 'Input variable (from a previous "Collect input" step)',
  },
  outputPrefixLabel: { es: "Prefijo donde guardar el resultado", en: "Prefix to store the result under" },
  ifFoundGoesTo: { es: "Si encuentra → avanza a", en: "If found → goes to" },
  ifNotFoundGoesTo: { es: "Si no encuentra → avanza a", en: "If not found → goes to" },
  hide: { es: "Ocultar", en: "Hide" },
  show: { es: "Mostrar", en: "Show" },
  advancedOptions: { es: "opciones avanzadas", en: "advanced options" },
  nodeKey: { es: "Clave del nodo", en: "Step key" },

  // send_buttons form
  bodyText: { es: "Texto del cuerpo", en: "Body text" },
  footerText: { es: "Pie de página", en: "Footer text" },
  buttonsRange: { es: "Botones (1–3)", en: "Buttons (1–3)" },
  visibleTitlePlaceholder: { es: "Título visible", en: "Visible title" },
  addButtonForm: { es: "Añadir botón", en: "Add button" },
  maxThreeButtonsList: {
    es: "WhatsApp permite máximo 3 botones de respuesta. Usa una lista para más opciones.",
    en: "WhatsApp allows up to 3 reply buttons. Use a list for more options.",
  },
  deleteButton: { es: "Eliminar botón", en: "Delete button" },

  // send_list form
  listButtonLabel: { es: "Texto del botón que despliega la lista", en: "Text for the button that opens the list" },
  rowsMaxTotal: { es: "Filas (máximo 10 en total)", en: "Rows (max 10 total)" },
  sectionTitlePlaceholder: { es: "Título de la sección {n}", en: "Section {n} title" },
  deleteSection: { es: "Eliminar sección", en: "Delete section" },
  rowTitlePlaceholder: { es: "Título de la fila", en: "Row title" },
  deleteRow: { es: "Eliminar fila", en: "Delete row" },
  addRowForm: { es: "Añadir fila", en: "Add row" },
  whatsappRowLimit: {
    es: "Límite WhatsApp: 10 filas por mensaje. Encadená otro nodo de lista.",
    en: "WhatsApp limit: 10 rows per message. Chain another list step.",
  },
  addSection: { es: "Añadir sección", en: "Add section" },

  // condition form
  condIf: { es: "Si", en: "If" },
  condSubjectVar: { es: "Variable capturada", en: "Captured variable" },
  condSubjectTag: { es: "El contacto tiene la etiqueta", en: "The contact has the tag" },
  condSubjectField: { es: "Campo del contacto", en: "Contact field" },
  condVarName: { es: "nombre de variable", en: "variable name" },
  condTag: { es: "Etiqueta", en: "Tag" },
  condField: { es: "Campo", en: "Field" },
  fieldName: { es: "nombre", en: "name" },
  fieldEmail: { es: "correo", en: "email" },
  fieldPhone: { es: "teléfono", en: "phone" },
  fieldCompany: { es: "empresa", en: "company" },
  condVarPlaceholder: { es: "correo", en: "email" },
  condTagPlaceholder: { es: "UUID de la etiqueta", en: "Tag UUID" },
  operator: { es: "Operador", en: "Operator" },
  opPresent: { es: "existe", en: "exists" },
  opAbsent: { es: "no existe", en: "doesn't exist" },
  opEquals: { es: "es igual a", en: "is equal to" },
  opContains: { es: "contiene", en: "contains" },
  opNotContains: { es: "no contiene", en: "doesn't contain" },
  opRegex: { es: "coincide con (regex)", en: "matches (regex)" },
  ifTrueGoesTo: { es: "Si es verdadero → avanza a", en: "If true → goes to" },
  ifFalseGoesTo: { es: "Si es falso → avanza a", en: "If false → goes to" },

  // set_tag form
  action: { es: "Acción", en: "Action" },
  addTag: { es: "Añadir etiqueta", en: "Add tag" },
  removeTag: { es: "Quitar etiqueta", en: "Remove tag" },
  tag: { es: "Etiqueta", en: "Tag" },
  thenGoesTo: { es: "Luego avanza a", en: "Then goes to" },

  // NodeKeySelect
  choose: { es: "Elegir", en: "Choose" },
  noConnection: { es: "Sin conexión", en: "No connection" },

  // Validation panel
  errorsAndWarnings: {
    es: "{errors} {errorsLabel}, {warnings} {warningsLabel}",
    en: "{errors} {errorsLabel}, {warnings} {warningsLabel}",
  },
  errorOne: { es: "error", en: "error" },
  errorMany: { es: "errores", en: "errors" },
  warningOne: { es: "advertencia", en: "warning" },
  warningMany: { es: "advertencias", en: "warnings" },
  tapViewError: { es: 'Toca "Ver error" para ir al paso', en: 'Tap "View error" to jump to the step' },
  viewErrorAt: { es: "Ver error en {label}", en: "View error in {label}" },
  viewError: { es: "Ver error", en: "View error" },

  // ai_intent form
  aiPromptBeforeReply: {
    es: "Mensaje al cliente antes de esperar su respuesta (opcional)",
    en: "Message to the customer before waiting for their reply (optional)",
  },
  intentsToClassify: { es: "Intenciones a clasificar", en: "Intents to classify" },
  removeIntent: { es: "Quitar intención", en: "Remove intent" },
  intentWhenPlaceholder: {
    es: "Cuándo aplica (ej: 'cliente pregunta por envíos')",
    en: "When it applies (e.g. 'customer asks about shipping')",
  },
  ifMatchesGoesTo: { es: "Si coincide → avanza a", en: "If it matches → goes to" },
  addIntent: { es: "Añadir intención", en: "Add intent" },
  ifNoIntentGoesTo: { es: "Si ninguna intención coincide → avanza a", en: "If no intent matches → goes to" },

  // CascadeDeleteDialog
  cascadeNounButton: { es: "botón", en: "button" },
  cascadeNounRow: { es: "opción", en: "option" },
  cascadeStepsOne: { es: "1 paso", en: "1 step" },
  cascadeStepsMany: { es: "{n} pasos", en: "{n} steps" },
  cascadeTitle: { es: "¿Borrar también los pasos siguientes?", en: "Delete the following steps too?" },
  cascadeDescWith: {
    es: "Este {noun} conecta con {steps} que sólo se usan desde acá. Si lo borras solo, esos pasos van a quedar desconectados (y te van a aparecer como pasos sueltos).",
    en: "This {noun} connects to {steps} that are only used from here. If you delete it alone, those steps will be left disconnected (and show up as loose steps).",
  },
  cascadeDescWithout: {
    es: "Este {noun} apunta a un paso que también usan otras ramas, así que solo borraremos el {noun} — los pasos siguientes quedan intactos.",
    en: "This {noun} points to a step that other branches also use, so we'll only delete the {noun} — the following steps stay intact.",
  },
  cascadeOnly: { es: "Sólo el {noun}", en: "Only the {noun}" },
  cascadeDeleteWith: { es: "Borrar el {noun} y los {steps}", en: "Delete the {noun} and the {steps}" },

  // Floating add palette
  addStepToMenu: { es: "Agregar un paso al menú", en: "Add a step to the menu" },
  addStep: { es: "Agregar paso", en: "Add step" },
  whichStepType: { es: "¿Qué tipo de paso?", en: "Which kind of step?" },

  // Canvas trigger card
  triggerTypeKeyword: { es: "Contiene una palabra clave", en: "Contains a keyword" },
  triggerTypeFirstMessage: { es: "Primer mensaje del cliente", en: "Customer's first message" },
  triggerTypeManual: { es: "Solo manual", en: "Manual only" },
  whenItTriggers: { es: "Cuándo dispara", en: "When it triggers" },
  when: { es: "Cuándo", en: "When" },
  keywordsLabel: { es: "Palabras clave (separadas por coma)", en: "Keywords (comma-separated)" },
  keywordsPlaceholder: { es: "soporte, ayuda, hola", en: "support, help, hi" },

  // Analytics badge
  analyticsEntriesTitle: { es: "{n} entradas en 7 días", en: "{n} entries in 7 days" },
  hasErrors: { es: "Tiene errores", en: "Has errors" },
} satisfies Namespace;
