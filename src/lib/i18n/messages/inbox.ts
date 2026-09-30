import type { Namespace } from "./types";

/**
 * Unified inbox (/bandeja): conversation list, message thread, composer,
 * reactions, moderation, contact + Shopify panels, templates and search.
 */
export const inbox = {
  orderActions: { es:'Acciones del pedido', en:'Order actions' },
  orderOperation: { es:'Acción', en:'Action' },
  orderRefund: { es:'Reembolsar', en:'Refund' },
  orderCancel: { es:'Cancelar y devolver el saldo cobrado', en:'Cancel and refund the captured balance' },
  orderAddress: { es:'Cambiar dirección de envío', en:'Change shipping address' },
  orderAddress1: { es:'Calle y número', en:'Street and number' },
  orderAddress2: { es:'Apartamento o unidad', en:'Apartment or unit' },
  orderAddressCity: { es:'Ciudad', en:'City' },
  orderAddressProvince: { es:'Provincia o departamento', en:'State or province' },
  orderAddressZip: { es:'Código postal', en:'Postal code' },
  orderAddressCountry: { es:'País', en:'Country' },
  orderAddressBefore: { es:'Dirección actual', en:'Current address' },
  orderAddressAfter: { es:'Nueva dirección', en:'New address' },
  orderAddressApplied: { es:'Dirección verificada en Shopify', en:'Address verified in Shopify' },
  orderAddressConfirm: { es:'Revisé ambas direcciones y el motivo. Confirmo el cambio en Shopify.', en:'I reviewed both addresses and the reason. I confirm the change in Shopify.' },
  orderAddressReconcileConfirm: { es:'Verifiqué la operación y la dirección actual en Shopify. Permito preparar nuevas operaciones.', en:'I verified the operation and current address in Shopify. I allow new operations to be prepared.' },
  orderAddressNeedsConfirmation: { es:'La validación encontró una coincidencia que debes confirmar.', en:'Address validation found a match that needs your confirmation.' },
  orderAddressInvalid: { es:'Revisa la calle, ciudad y país antes de continuar.', en:'Review the street, city and country before continuing.' },
  orderAddressUnavailable: { es:'Este pedido no tiene una dirección de envío que se pueda verificar.', en:'This order has no verifiable shipping address.' },
  orderAddressUnchanged: { es:'La nueva dirección coincide con la actual.', en:'The new address matches the current address.' },
  orderAddressRejected: { es:'Shopify rechazó la dirección. Revisa los datos.', en:'Shopify rejected the address. Review the details.' },
  orderAddressValidationUnavailable: { es:'La validación de direcciones no respondió. Reintenta antes de aplicar el cambio.', en:'Address validation did not respond. Try again before applying the change.' },
  orderAmount: { es:'Importe de devolución', en:'Refund amount' },
  orderActualRefund: { es:'Importe devuelto', en:'Amount refunded' },
  orderAvailableBalance: { es:'Saldo actual disponible para devolver', en:'Current available refundable balance' },
  orderFullBalance: { es:'Todo el saldo disponible', en:'Entire available balance' },
  orderNoRefund: { es:'Sin saldo cobrado pendiente de devolución', en:'No captured balance remaining to refund' },
  orderReason: { es:'Motivo', en:'Reason' },
  orderPreview: { es:'Ver antes de aplicar', en:'Preview changes' },
  orderPreviewExpires: { es:'Válido hasta {date}', en:'Valid until {date}' },
  orderConfirm: { es:'Revisé este pedido, el importe y el motivo. Confirmo la operación en Shopify.', en:'I reviewed this order, amount and reason. I confirm the operation in Shopify.' },
  orderExecute: { es:'Confirmar y ejecutar', en:'Confirm and execute' },
  orderNewPreview: { es:'Volver', en:'Back' },
  orderHistory: { es:'Historial del pedido', en:'Order history' },
  orderReview: { es:'Revisar', en:'Review' },
  orderReconcile: { es:'Revisar resultado en Shopify', en:'Review Shopify result' },
  orderReconcileConfirm: { es:'Verifiqué la operación en Shopify y este saldo actual. Permito preparar nuevas operaciones.', en:'I verified the operation in Shopify and this current balance. I allow new operations to be prepared.' },
  orderReconcileReason: { es:'Qué verificaste', en:'What you verified' },
  orderReconcileSave: { es:'Registrar revisión', en:'Record review' },
  orderRequestedBy: { es:'Preparó: {actor}', en:'Prepared by: {actor}' },
  orderApprovedBy: { es:'Confirmó: {actor}', en:'Confirmed by: {actor}' },
  orderNotFound: { es:'Este pedido no está asociado a este contacto en Riverz.', en:'This order is not associated with this contact in Riverz.' },
  orderStoreChanged: { es:'La tienda de este pedido no coincide con la conexión activa.', en:'This order’s store does not match the active connection.' },
  orderIdentityUnknown: { es:'Los datos del cliente en Shopify no coinciden con este contacto. Revisa su identidad antes de continuar.', en:'The customer details in Shopify do not match this contact. Verify their identity before continuing.' },
  orderScopeMissing: { es:'Shopify no concedió permiso para modificar pedidos.', en:'Shopify has not granted permission to change orders.' },
  orderAlreadyShipped: { es:'El pedido está cancelado o su despacho ya comenzó. Revisa el caso en Shopify.', en:'This order is cancelled or fulfillment has already started. Review the case in Shopify.' },
  orderBalanceUnknown: { es:'No se pudo verificar el saldo disponible para devolver.', en:'Could not verify the available refundable balance.' },
  orderAmountTooHigh: { es:'El importe supera el saldo disponible para devolver.', en:'The amount exceeds the available refundable balance.' },
  orderRefundPending: { es:'Hay una devolución pendiente en Shopify. Revisa su resultado antes de continuar.', en:'There is a pending refund in Shopify. Review its result before continuing.' },
  orderUnavailable: { es:'No se pudo consultar el pedido. Reintenta.', en:'Could not load the order. Try again.' },
  orderApprovalForbidden: { es:'La ejecución requiere un administrador del negocio.', en:'Execution requires a business administrator.' },
  orderBusy: { es:'Este pedido tiene una operación en curso o sin verificar. Revisa su resultado en Shopify.', en:'This order has an operation in progress or awaiting verification. Review its result in Shopify.' },
  orderConflict: { es:'No se pudo usar esta vista previa. Vuelve a revisar el pedido.', en:'Could not use this preview. Review the order again.' },
  orderChanged: { es:'El pedido cambió después de la revisión. Prepara una nueva vista previa.', en:'The order changed after review. Prepare a new preview.' },
  orderResultUnverified: { es:'Comprueba el resultado en Shopify antes de solicitar otra operación. Riverz no la repetirá automáticamente.', en:'Check the result in Shopify before requesting another operation. Riverz will not repeat it automatically.' },
  'orderStatus.preview': { es:'Espera confirmación', en:'Awaiting confirmation' },
  'orderStatus.running': { es:'En ejecución; revisa el resultado en Shopify', en:'Executing; check the result in Shopify' },
  'orderStatus.completed': { es:'Completada y verificada', en:'Completed and verified' },
  'orderStatus.failed': { es:'No aplicada', en:'Not applied' },
  'orderStatus.uncertain': { es:'Resultado sin verificar', en:'Result awaiting verification' },
  'orderStatus.expired': { es:'Vista previa vencida', en:'Preview expired' },
  'orderStatus.reviewed': { es:'Resultado revisado por una persona', en:'Result reviewed by a person' },
  teamNotices: { es: 'Avisos del equipo', en: 'Team notifications' },
  teamNoNotices: { es: 'No tienes avisos pendientes.', en: 'You have no pending notifications.' },
  followupsTitle: { es: 'Seguimiento y macros', en: 'Follow-ups and macros' },
  followupInvalidDate: { es: 'Elige una fecha futura.', en: 'Choose a future date.' },
  followupKind: { es: 'Tipo de seguimiento', en: 'Follow-up type' },
  followupDate: { es: 'Fecha y hora', en: 'Date and time' },
  followupTimezone: { es: 'Horario de este dispositivo: {zone}', en: 'This device’s time zone: {zone}' },
  snoozedUntil: { es: 'Pospuesto hasta {date}', en: 'Snoozed until {date}' },
  resumeNow: { es: 'Retomar ahora', en: 'Resume now' },
  reminderBody: { es: 'Qué necesitas recordar', en: 'What you need to remember' },
  snoozeExplanation: { es: 'Sale de la lista activa y vuelve en la fecha elegida o cuando el cliente escribe. No envía un mensaje al cliente.', en: 'Leaves the active list and returns on the selected date or when the customer writes. Does not message the customer.' },
  reminderExplanation: { es: 'Recibirás un aviso privado en Riverz. No envía un mensaje al cliente.', en: 'You will receive a private notification in Riverz. Does not message the customer.' },
  scheduleFollowup: { es: 'Programar seguimiento', en: 'Schedule follow-up' },
  cancelReminder: { es: 'Cancelar recordatorio', en: 'Cancel reminder' },
  snoozeNotification: { es: 'El caso pospuesto volvió a la bandeja.', en: 'The snoozed case returned to the inbox.' },
  viewStatus_snoozed: { es: 'Pospuestos', en: 'Snoozed' },
  actionHistory: { es: 'Historial de acciones', en: 'Action history' },
  macrosTitle: { es: 'Macros del equipo', en: 'Team macros' },
  macrosExplanation: { es: 'Una macro combina acciones. Revisa el alcance antes de aplicarla. Las notas y los recordatorios son internos.', en: 'A macro combines actions. Review its scope before applying it. Notes and reminders are internal.' },
  selectMacro: { es: 'Elegir macro', en: 'Choose a macro' },
  reviewMacro: { es: 'Revisé estas acciones para este caso.', en: 'I reviewed these actions for this case.' },
  applyMacro: { es: 'Aplicar al caso', en: 'Apply to case' },
  editMacro: { es: 'Editar macro', en: 'Edit macro' },
  archiveMacro: { es: 'Archivar macro', en: 'Archive macro' },
  newMacro: { es: 'Crear macro', en: 'Create macro' },
  macroName: { es: 'Nombre de la macro', en: 'Macro name' },
  macroAction: { es: 'Acción de la macro', en: 'Macro action' },
  removeMacroAction: { es: 'Quitar acción', en: 'Remove action' },
  actionMinutes: { es: 'Minutos después de aplicar', en: 'Minutes after applying' },
  macroTag: { es: 'Etiqueta', en: 'Tag' },
  selectTag: { es: 'Elegir etiqueta', en: 'Choose tag' },
  teamGroup: { es: 'Equipo responsable', en: 'Responsible team' },
  selectTeam: { es: 'Elegir equipo', en: 'Choose team' },
  addMacroAction: { es: 'Añadir acción', en: 'Add action' },
  saveMacro: { es: 'Guardar macro', en: 'Save macro' },
  macroLimit: { es: 'Este negocio ya tiene 100 macros activas. Archiva una antes de crear otra.', en: 'This business already has 100 active macros. Archive one before creating another.' },
  macroChanged: { es: 'La macro cambió. Carga su versión actual y revisa las acciones.', en: 'The macro changed. Load its current version and review the actions.' },
  actionConflict: { es: 'El caso cambió o la acción ya no está disponible. Revisa su estado antes de reintentar.', en: 'The case changed or the action is no longer available. Review its state before retrying.' },
  teamUnavailable: { es: 'No hay un integrante disponible con capacidad. La macro no se aplicó.', en: 'No team member is available with capacity. The macro was not applied.' },
  action_snooze: { es: 'Posponer caso', en: 'Snooze case' },
  action_resume: { es: 'Retomar caso', en: 'Resume case' },
  action_reminder: { es: 'Crear recordatorio privado', en: 'Create private reminder' },
  action_cancel_reminder: { es: 'Cancelar recordatorio', en: 'Cancel reminder' },
  action_note: { es: 'Añadir nota interna', en: 'Add internal note' },
  action_case: { es: 'Cambiar prioridad y motivo', en: 'Change priority and reason' },
  action_tag: { es: 'Añadir etiqueta al contacto', en: 'Add contact tag' },
  action_assign: { es: 'Asignar con capacidad disponible', en: 'Assign with available capacity' },
  actionAfterMinutes: { es: 'Después de {minutes} minutos', en: 'After {minutes} minutes' },
  tagMayTrigger: { es: 'Añadir etiquetas puede iniciar las automatizaciones activas de este negocio.', en: 'Adding tags may start this business’s active automations.' },
  actionTargetUnknown: { es: 'Destino no disponible: revisa la configuración de la macro.', en: 'Destination unavailable: review the macro configuration.' },
  teamWorkTitle: { es: 'Equipo y disponibilidad', en: 'Team and availability' },
  teamAvailable: { es: 'Disponible', en: 'Available' },
  teamUnavailableLabel: { es: 'No disponible', en: 'Unavailable' },
  teamDisabled: { es: 'Deshabilitado para nuevas asignaciones', en: 'Disabled for new assignments' },
  teamAvailabilityExplanation: { es: 'La asignación respeta disponibilidad y capacidad. Los casos que ya atiendes conservan su responsable.', en: 'Assignment respects availability and capacity. Your existing cases keep their owner.' },
  teamLoad: { es: '{active} casos activos de {capacity}', en: '{active} active cases out of {capacity}' },
  teamCapacity: { es: 'Capacidad de casos activos', en: 'Active case capacity' },
  teamDisable: { es: 'Deshabilitar', en: 'Disable' },
  teamEnable: { es: 'Habilitar', en: 'Enable' },
  teamAdminsOnly: { es: 'Solo un administrador puede cambiar el equipo o la capacidad.', en: 'Only an administrator can change teams or capacity.' },
  teamGroupLimit: { es: 'El negocio ya tiene 50 equipos. Edita uno existente.', en: 'This business already has 50 teams. Edit an existing team.' },
  editTeam: { es: 'Editar equipo', en: 'Edit team' },
  newTeam: { es: 'Crear equipo', en: 'Create team' },
  teamGroupName: { es: 'Nombre del equipo', en: 'Team name' },
  teamGroupEnabled: { es: 'Equipo habilitado para recibir casos', en: 'Team enabled to receive cases' },
  inboxShortcutsHelp: { es: 'Atajos fuera de los campos de texto: Alt+J siguiente caso, Alt+K anterior, Alt+R responder, Alt+F buscar.', en: 'Shortcuts outside text fields: Alt+J next case, Alt+K previous, Alt+R reply, Alt+F search.' },
  bulkMacro: { es: 'Aplicar macro', en: 'Apply macro' },
  bulkReview: { es: 'Revisar casos seleccionados', en: 'Review selected cases' },
  bulkMacroExplanation: { es: 'Estas acciones solo alcanzan los casos listados. Cada caso conserva su propio resultado.', en: 'These actions only affect the listed cases. Each case keeps its own result.' },
  bulkMacroConfirm: { es: 'Revisé la macro y estos casos seleccionados.', en: 'I reviewed the macro and these selected cases.' },
  bulkMacroApply: { es: 'Aplicar a {n} casos', en: 'Apply to {n} cases' },
  bulkMacroLimit: { es: 'Selecciona entre 1 y 100 casos para aplicar una macro.', en: 'Select between 1 and 100 cases to apply a macro.' },
  bulkMacroResult: { es: '{ok} casos completados; {failed} con error.', en: '{ok} cases completed; {failed} failed.' },
  bulkMacroFailed: { es: 'No se aplicó la macro a este caso. Revisa sus permisos, configuración y disponibilidad.', en: 'The macro was not applied to this case. Review permissions, configuration and availability.' },
  bulkMacroRetry: { es: 'Reintentar casos con error', en: 'Retry failed cases' },
  teamTitle: { es: 'Equipo y notas', en: 'Team and notes' },
  relatedTitle: { es: 'Casos relacionados', en: 'Related cases' },
  relatedCase: { es: 'Conversación', en: 'Conversation' },
  relatedChoose: { es: 'Elegir otro caso del contacto', en: 'Choose another case for this contact' },
  relatedPreview: { es: 'Revisar conversación', en: 'Review conversation' },
  relatedConfirm: { es: 'Revisé ambos casos y corresponden a la misma persona.', en: 'I reviewed both cases and they belong to the same person.' },
  relatedLink: { es: 'Vincular casos', en: 'Link cases' },
  relatedUnlink: { es: 'Quitar vínculo', en: 'Remove link' },
  savedViews: { es: 'Vistas guardadas', en: 'Saved views' },
  viewLimit: { es: 'Puedes guardar hasta 50 vistas por negocio. Elimina una antes de crear otra.', en: 'You can save up to 50 views per business. Remove one before adding another.' },
  allCases: { es: 'Todos los casos', en: 'All cases' },
  sharedView: { es: 'Compartida', en: 'Shared' },
  newView: { es: 'Crear vista', en: 'Create view' },
  deleteView: { es: 'Eliminar vista', en: 'Delete view' },
  viewName: { es: 'Nombre de la vista', en: 'View name' },
  viewChannel: { es: 'Canal', en: 'Channel' },
  viewStatus: { es: 'Estado', en: 'Status' },
  viewAssignee: { es: 'Responsable', en: 'Assignee' },
  viewAny: { es: 'Todos', en: 'All' },
  viewStatus_unread: { es: 'Sin leer', en: 'Unread' },
  viewStatus_unassigned: { es: 'Sin asignar', en: 'Unassigned' },
  viewStatus_mine: { es: 'Mis casos', en: 'My cases' },
  viewStatus_open: { es: 'Abiertos', en: 'Open' },
  viewStatus_pending: { es: 'Pendientes', en: 'Pending' },
  viewStatus_closed: { es: 'Cerrados', en: 'Closed' },
  shareView: { es: 'Compartir con el equipo', en: 'Share with the team' },
  saveView: { es: 'Guardar vista', en: 'Save view' },
  teamMentions: { es: 'Menciones al equipo', en: 'Team mentions' },
  teamNoMentions: { es: 'No tienes menciones.', en: 'You have no mentions.' },
  teamNote: { es: 'Nota interna', en: 'Internal note' },
  teamNotePlaceholder: { es: 'Solo la ve tu equipo. No se envía al cliente.', en: 'Visible to your team only. Never sent to the customer.' },
  teamAddNote: { es: 'Guardar nota', en: 'Save note' },
  teamOlderNotes: { es: 'Notas anteriores', en: 'Earlier notes' },
  teamMember: { es: 'Miembro del equipo', en: 'Team member' },
  teamComposing: { es: '{names} está preparando una respuesta. Coordina antes de enviar.', en: '{names} is preparing a reply. Coordinate before sending.' },
  teamSendAnyway: { es: '{names} está preparando una respuesta en este caso. ¿Ya coordinaron y quieres enviar tu respuesta?', en: '{names} is preparing a reply in this case. Have you coordinated and do you want to send your reply?' },
  teamPresenceUnavailable: { es: 'No se pudo comprobar si alguien más está respondiendo. ¿Quieres enviar de todas formas?', en: 'Could not check whether someone else is replying. Send anyway?' },
  teamViewing: { es: '{names} está viendo esta conversación.', en: '{names} is viewing this conversation.' },
  teamUnauthorized: { es: 'Inicia sesión para continuar.', en: 'Sign in to continue.' },
  teamNotFound: { es: 'No se encontró esta conversación.', en: 'Conversation not found.' },
  teamFailed: { es: 'No se pudieron cargar o guardar los datos del equipo.', en: 'Could not load or save team data.' },
  teamInvalid: { es: 'Revisa la nota y los miembros seleccionados.', en: 'Review the note and selected team members.' },
  casePriority: { es: 'Prioridad del caso', en: 'Case priority' },
  casePriority_normal: { es: 'Normal', en: 'Normal' },
  casePriority_high: { es: 'Alta', en: 'High' },
  casePriority_urgent: { es: 'Urgente', en: 'Urgent' },
  caseReason: { es: 'Motivo del caso', en: 'Case reason' },
  caseUnclassified: { es: 'Sin clasificar', en: 'Unclassified' },
  caseReason_purchase: { es: 'Compra', en: 'Purchase' },
  caseReason_delivery: { es: 'Envío', en: 'Delivery' },
  caseReason_payment: { es: 'Pago', en: 'Payment' },
  caseReason_return: { es: 'Devolución o cambio', en: 'Return or exchange' },
  caseReason_other: { es: 'Otro', en: 'Other' },
  recoverMedia: { es: 'Recuperar archivo', en: 'Recover attachment' },
  recoveringMedia: { es: 'Consultando archivo…', en: 'Checking attachment…' },
  mediaStillUnavailable: { es: '{channel} no devolvió el archivo.', en: '{channel} did not return the attachment.' },
  openChannelApp: { es: 'Abrir en la app', en: 'Open in app' },
  sourcePostId: { es: 'Publicación {id}', en: 'Post {id}' },
  openSourceComment: { es: 'Ver comentario de origen', en: 'View original comment' },
  openSourcePost: { es: 'Ver publicación', en: 'View post' },
  openPrivateReply: { es: 'Ver respuesta privada', en: 'View private reply' },
  templateButtonLink: { es: 'Enlace de «{button}»', en: 'Link for “{button}”' },
  templateLinkRequired: { es: 'Completa el enlace del botón.', en: 'Enter the button link.' },
  templateLinkInvalid: { es: 'Introduce un enlace completo válido.', en: 'Enter a valid full URL.' },
  templateLinkMismatch: { es: 'El enlace debe coincidir con la dirección aprobada del botón.', en: 'The link must match the approved button URL.' },
  templateFieldsRequired: { es: 'Completa todas las variables de la plantilla.', en: 'Fill in all template variables.' },
  // Mandó el comprobante y no encontramos su pedido.
  needsHumanComprobante: {
    es: "Mandó el comprobante y no encontramos su pedido",
    en: "Sent the receipt and we could not find their order",
  },

  // El comentario que abrió un hilo privado.
  originCommentInbound: { es: "Vino de un comentario", en: "Came from a comment" },

  // La etiqueta del hilo que el asistente dejó de atender. Corta a propósito:
  // en una fila de lista compite con el nombre y el último mensaje.
  needsHumanBadge: { es: "Revisar ya", en: "Review now" },
  // Channel filter row
  allChannels: { es: "Todos", en: "All" },

  // Inbox tabs
  tabMessages: { es: "Mensajes", en: "Messages" },
  tabComments: { es: "Comentarios", en: "Comments" },
  tabUnify: { es: "Unificar", en: "Unify" },
  needsHuman: { es: "Necesita humano", en: "Needs a human" },
  // Motivos por los que la IA dejó el hilo a una persona (migración 122).
  needsHumanKeyword: { es: "El cliente pidió hablar con una persona", en: "The customer asked for a person" },
  needsHumanMaxReplies: { es: "El asistente agotó sus respuestas para este chat", en: "The assistant used up its replies for this chat" },
  needsHumanFlow: { es: "Un flujo lo pasó a una persona", en: "A flow handed it to a person" },
  needsHumanBurst: {
    es: "Se enviaron demasiados mensajes seguidos a este contacto",
    en: "Too many messages were sent to this contact in a row",
  },
  needsHumanApproval: {
    es: "Hay algo pedido que el agente no pudo avisarte por WhatsApp.",
    en: "Something is pending that the agent could not text you about.",
  },
  needsHumanUnknown: {
    es: "El agente no supo contestar y anotó la pregunta.",
    en: "The agent did not know the answer and logged the question.",
  },
  needsHumanAsked: {
    es: "El visitante pidió hablar con una persona desde el chat web.",
    en: "The visitor asked to talk to a person from the web chat.",
  },

  needsHumanNoRecibido: {
    es: "Sigue mandando algo que {channel} no nos entrega. Ábrelo en la app: ahí sí se ve.",
    en: "They keep sending something {channel} doesn't deliver to us. Open it in the app, it shows there.",
  },
  needsHumanProblema: {
    es: "Hay un problema en curso que el asistente no puede resolver.",
    en: "There's an ongoing problem the assistant can't resolve.",
  },
  needsHumanResolve: { es: "Marcar como resuelto", en: "Mark as resolved" },

  needsHumanSinRespuesta: {
    es: "El asistente no llegó a responder este mensaje. Contéstalo tú.",
    en: "The assistant couldn't answer this message. Reply yourself.",
  },
  needsHumanIaCaida: {
    es: "El asistente no pudo responder este mensaje. Revísalo antes de cerrar el chat.",
    en: "The assistant couldn't answer this message. Review it before closing the chat.",
  },

  needsHumanSinModerar: {
    es: "Meta no nos dejó responder ni ocultar este comentario. Sigue publicado: revisa los permisos de la cuenta en Ajustes → Canales.",
    en: "Meta wouldn't let us reply to or hide this comment. It's still public: check the account's permissions in Settings → Channels.",
  },

  // Status filter (conversation list)
  filterAll: { es: "Todas", en: "All" },
  filterOpen: { es: "Abiertas", en: "Open" },
  filterPending: { es: "Pendientes", en: "Pending" },
  filterClosed: { es: "Cerradas", en: "Closed" },

  // New WhatsApp chat compose
  newChat: { es: "Nuevo chat", en: "New chat" },
  newChatTitle: { es: "Nuevo chat de WhatsApp", en: "New WhatsApp chat" },
  newChatDesc: {
    es: "Escribe el número con código de país.",
    en: "Type the number with country code.",
  },
  recipientPhone: { es: "Número de WhatsApp", en: "WhatsApp number" },
  recipientName: { es: "Nombre (opcional)", en: "Name (optional)" },
  newChatContinue: { es: "Continuar", en: "Continue" },
  newChatWindowOpen: {
    es: "Ventana de 24 h abierta. Puedes enviar un mensaje de texto.",
    en: "24h window open. You can send a free text message.",
  },
  newChatNeedsTemplate: {
    es: "Número nuevo o fuera de la ventana de 24 h: elige una plantilla aprobada.",
    en: "New number or outside the 24h window: pick an approved template.",
  },
  newChatMessage: { es: "Mensaje", en: "Message" },
  newChatTemplate: { es: "Plantilla", en: "Template" },
  newChatTemplateVar: { es: "Variable {n}", en: "Variable {n}" },
  newChatNoTemplates: {
    es: "No tienes plantillas aprobadas. Crea una en Plantillas.",
    en: "You have no approved templates. Create one in Templates.",
  },
  newChatSend: { es: "Enviar", en: "Send" },
  newChatSending: { es: "Enviando…", en: "Sending…" },
  newChatSent: { es: "Mensaje enviado", en: "Message sent" },
  newChatFailed: { es: "No se pudo enviar: {reason}", en: "Couldn't send: {reason}" },

  // Conversation list — selection, bulk actions
  select: { es: "Seleccionar", en: "Select" },
  cancel: { es: "Cancelar", en: "Cancel" },
  delete: { es: "Eliminar", en: "Delete" },
  deleting: { es: "Eliminando…", en: "Deleting…" },
  actions: { es: "Acciones", en: "Actions" },
  selectAll: { es: "Seleccionar todo", en: "Select all" },
  deselectAll: { es: "Quitar selección", en: "Deselect all" },
  selectedCount: { es: "{n} seleccionada(s)", en: "{n} selected" },
  bulkDeleteConfirm: {
    es: "¿Eliminar {n} conversación(es)?",
    en: "Delete {n} conversation(s)?",
  },
  bulkDeleteSuccess: { es: "{n} eliminada(s)", en: "{n} deleted" },
  bulkDeleteFailed: { es: "{n} no eliminada(s)", en: "{n} not deleted" },

  // Conversation row
  deleteConversation: { es: "Eliminar conversación", en: "Delete conversation" },
  deleteConversationConfirm: {
    es: "¿Eliminar conversación?",
    en: "Delete this conversation?",
  },
  deleteFailed: { es: "No se pudo eliminar", en: "Couldn't delete" },
  deleted: { es: "Eliminada", en: "Deleted" },
  networkError: { es: "Error de red", en: "Network error" },
  noMessages: { es: "Sin mensajes", en: "No messages" },
  unreplied: { es: "Sin responder", en: "Unanswered" },
  yesterday: { es: "Ayer", en: "Yesterday" },
  today: { es: "Hoy", en: "Today" },
  noName: { es: "Sin nombre", en: "No name" },
  instagramCustomer: {
    es: "Cliente Instagram · …{id}",
    en: "Instagram customer · …{id}",
  },
  messengerCustomer: {
    es: "Cliente Messenger · …{id}",
    en: "Messenger customer · …{id}",
  },
  mercadolibreCustomer: {
    es: "Cliente Mercado Libre · …{id}",
    en: "Mercado Libre customer · …{id}",
  },

  // Conversation list — empty states
  noResults: { es: "Sin resultados", en: "No results" },
  emptyInbox: { es: "Tu bandeja está vacía", en: "Your inbox is empty" },
  emptyFilteredHint: {
    es: "Prueba quitar el filtro o ampliar la búsqueda.",
    en: "Try clearing the filter or broadening your search.",
  },
  emptyInboxHint: {
    es: "Conecta WhatsApp, Instagram, Messenger o tu correo para empezar a recibir mensajes.",
    en: "Connect WhatsApp, Instagram, Messenger or your email to start receiving messages.",
  },
  // Canales YA conectados pero sin conversaciones todavía — no hay que conectar
  // nada, solo esperar el primer mensaje.
  emptyConnectedHint: {
    es: "Aún no llegaron mensajes. Cuando un cliente escriba, aparecerá aquí.",
    en: "No messages yet. When a customer writes, it'll show up here.",
  },
  // Chip de un canal específico activo y sin conversaciones en ese canal.
  emptyChannelHint: {
    es: "Aún no hay mensajes en este canal.",
    en: "No messages in this channel yet.",
  },
  connectChannel: { es: "Conectar un canal", en: "Connect a channel" },
  connectChannelArrow: { es: "Conectar un canal →", en: "Connect a channel →" },

  // Contact sidebar
  closePanel: { es: "Cerrar panel", en: "Close panel" },
  closeContactPanel: { es: "Cerrar panel de contacto", en: "Close contact panel" },
  selectConversation: {
    es: "Selecciona una conversación",
    en: "Select a conversation",
  },
  contactFallback: { es: "Contacto", en: "Contact" },
  aiSegment: { es: "Segmento IA", en: "AI segment" },
  recalculateSegment: { es: "Recalcular segmento", en: "Recalculate segment" },
  recentActivity: { es: "Actividad reciente", en: "Recent activity" },
  tags: { es: "Etiquetas", en: "Tags" },
  notes: { es: "Notas", en: "Notes" },
  notePlaceholder: { es: "Nota", en: "Note" },
  addNote: { es: "Agregar nota", en: "Add note" },

  // Comment moderation bar
  removeLike: { es: "Quitar me gusta", en: "Remove like" },
  likeAsPage: { es: "Me gusta como página", en: "Like as page" },
  showComment: { es: "Mostrar comentario", en: "Show comment" },
  hideComment: { es: "Ocultar comentario", en: "Hide comment" },
  deleteComment: { es: "Eliminar comentario", en: "Delete comment" },
  openInFacebookInstagram: {
    es: "Abrir en Facebook/Instagram",
    en: "Open in Facebook/Instagram",
  },
  moderationFailed: { es: "No se pudo completar la acción", en: "Action failed" },
  moderationHidden: { es: "Ocultado", en: "Hidden" },
  moderationVisible: { es: "Visible", en: "Visible" },
  moderationLiked: { es: "Me gusta", en: "Liked" },
  moderationUnliked: { es: "Quitado", en: "Like removed" },
  moderationDeleted: { es: "Eliminado", en: "Deleted" },
  moderationDone: { es: "Hecho", en: "Done" },

  // Native comment view
  commentLike: { es: "Me gusta", en: "Like" },
  commentDeleted: { es: "Comentario eliminado", en: "Comment deleted" },
  /** La lápida de la burbuja cuando borraron un MENSAJE (no un comentario).
   *  `messageDeleted` ya existe y es el aviso corto de "listo, lo borré". */
  messageRemoved: { es: "Mensaje eliminado", en: "Message deleted" },
  // Qué cambió y qué no: el comentario sigue entero acá, lo que dejó de estar
  // es a la vista del público.
  commentHiddenNotice: {
    es: "Oculto en la publicación",
    en: "Hidden on the post",
  },
  // Quién lo ocultó (migración 212). Se dice al lado del aviso de arriba:
  // "lo ocultó la IA" y "lo ocultó tu equipo" llevan a lugares distintos.
  hiddenByAi: { es: "lo ocultó la IA (spam)", en: "hidden by the AI (spam)" },
  hiddenByTeam: { es: "lo ocultó tu equipo", en: "hidden by your team" },
  hiddenByNetwork: { es: "lo ocultaron desde {red}", en: "hidden from {red}" },

  // Ad-referral banner (customer arrived from a click-to-message ad)
  adBadge: { es: "Anuncio", en: "Ad" },
  storyReplyBadge: { es: "Historia", en: "Story" },
  storyMentionBadge: { es: "Te mencionó", en: "Mentioned you" },

  // Perfil de Instagram investigado (contact_ig_profile)
  igProfileTitle: { es: "Su perfil", en: "Their profile" },
  igFollowers: { es: "{n} seguidores", en: "{n} followers" },
  igFollowsYou: { es: "Te sigue", en: "Follows you" },
  igVerified: { es: "Verificada", en: "Verified" },
  igPrivateAccount: {
    es: "Perfil privado: no se pudo investigar.",
    en: "Private profile: nothing to research.",
  },
  repliedToAd: { es: "Respondió a un anuncio", en: "Replied to an ad" },
  viewAd: { es: "Ver anuncio", en: "View ad" },

  // Message actions toolbar
  react: { es: "Reaccionar", en: "React" },
  reactWith: { es: "Reaccionar con {emoji}", en: "React with {emoji}" },
  reply: { es: "Responder", en: "Reply" },
  copy: { es: "Copiar", en: "Copy" },
  nothingToCopy: { es: "Nada para copiar", en: "Nothing to copy" },
  copied: { es: "Copiado", en: "Copied" },
  copyFailed: { es: "No se pudo copiar", en: "Couldn't copy" },
  // Diálogo de borrado (reemplaza al confirm del navegador)
  deleteMessageTitle: { es: "¿Eliminar mensaje?", en: "Delete message?" },
  deleteMessageBothDesc: {
    es: "Puedes quitarlo solo de tu bandeja o borrarlo también del lado del cliente.",
    en: "You can remove it just from your inbox, or delete it on the customer's side too.",
  },
  deleteMessageOnlyMineDesc: {
    es: "Se quita de tu bandeja. Este canal no permite borrarlo del lado del cliente.",
    en: "It's removed from your inbox. This channel can't delete it on the customer's side.",
  },
  deleteForEveryone: { es: "Eliminar para todos", en: "Delete for everyone" },
  deleteForMe: { es: "Eliminar solo para mí", en: "Delete only for me" },
  deleteMessageFailed: { es: "No se pudo borrar", en: "Couldn't delete" },
  messageDeleted: { es: "Borrado", en: "Deleted" },

  // Message bubble — media + content types
  mediaUnavailable: { es: "{label} no disponible", en: "{label} unavailable" },
  expandImage: { es: "Ampliar imagen", en: "Expand image" },
  expandVideo: { es: "Ampliar video", en: "Expand video" },
  download: { es: "Descargar", en: "Download" },
  attachmentUnavailable: {
    es: "{name} (no disponible)",
    en: "{name} (unavailable)",
  },
  file: { es: "Archivo", en: "File" },
  sharedImage: { es: "Imagen compartida", en: "Shared image" },
  image: { es: "Imagen", en: "Image" },
  video: { es: "Video", en: "Video" },
  audio: { es: "Audio", en: "Audio" },
  document: { es: "Documento", en: "Document" },
  template: { es: "Plantilla", en: "Template" },
  sharedLocation: { es: "Ubicación compartida", en: "Shared location" },
  buttonReply: { es: "Respuesta de botón", en: "Button reply" },
  interactiveReply: { es: "[Respuesta interactiva]", en: "[Interactive reply]" },
  // Qué es y qué hacer, en vez de un rótulo que parece un error nuestro.
  //
  // Decía "[No compatible]" y nadie —ni el comercio ni la IA— podía saber qué
  // había pasado: se leía como si Riverz hubiera roto algo. Es la plataforma: la
  // persona mandó algo que su API no reparte (ver-una-vez, modo temporal, una
  // encuesta, una función nueva) y llega el aviso sin archivo. En la app del
  // comercio sí se ve, y eso es lo único accionable.
  //
  // El canal se nombra en vez de darlo por sentado: decía "WhatsApp" a mano y
  // se mostraba encima de mensajes de Instagram, Messenger, Mercado Libre y
  // comentarios de TikTok.
  unsupported: {
    es: "{channel} no entrega este mensaje · ábrelo en la app",
    en: "{channel} doesn't deliver this message · open it in the app",
  },
  opinionComentar: { es: "Feedback", en: "Feedback" },
  enviadoPorAsistente: { es: "Asistente Riverz", en: "Riverz assistant" },
  opinionPlaceholder: { es: "¿Qué se debería mejorar en este mensaje?", en: "What should be improved about this message?" },
  opinionAviso: {
    es: "Riverz ve este tramo de la conversación para mejorar el asistente.",
    en: "Riverz sees this part of the conversation to improve the assistant.",
  },
  opinionError: { es: "No se pudo guardar la opinión.", en: "Couldn't save the feedback." },
  historyMediaMissing: {
    es: "Archivo de antes de conectar {channel}: no vino en el historial · ábrelo en la app",
    en: "File from before {channel} was connected: not included in the history · open it in the app",
  },
  writeOnWhatsapp: {
    es: "Escribir a {phone} por WhatsApp",
    en: "Message {phone} on WhatsApp",
  },
  unsupportedMedia: {
    es: "{channel} no entrega este contenido · ábrelo en la app",
    en: "{channel} doesn't deliver this content · open it in the app",
  },
  noContent: { es: "[sin contenido]", en: "[no content]" },
  email: { es: "Correo", en: "Email" },
  you: { es: "Tú", en: "You" },
  customer: { es: "Cliente", en: "Customer" },

  // Reply quote
  cancelReply: { es: "Cancelar respuesta", en: "Cancel reply" },
  previewImage: { es: "[Imagen]", en: "[Image]" },
  previewVideo: { es: "[Video]", en: "[Video]" },
  previewAudio: { es: "[Audio]", en: "[Audio]" },
  previewDocument: { es: "[Documento]", en: "[Document]" },
  previewLocation: { es: "[Ubicación]", en: "[Location]" },
  previewTemplate: { es: "[Plantilla]", en: "[Template]" },
  previewMessage: { es: "[Mensaje]", en: "[Message]" },
  previewSticker: { es: "[Sticker]", en: "[Sticker]" },
  previewContact: { es: "[Contacto]", en: "[Contact]" },
  previewOrder: { es: "[Pedido]", en: "[Order]" },
  previewButtonReply: { es: "[Respuesta]", en: "[Reply]" },
  previewInteractive: { es: "[Respuesta interactiva]", en: "[Interactive reply]" },
  previewStoryMention: { es: "[Mención en historia]", en: "[Story mention]" },
  previewSharedPost: { es: "[Publicación compartida]", en: "[Shared post]" },
  previewFileUnavailable: { es: "[Archivo no disponible]", en: "[File unavailable]" },

  // Composer — snippets, session window
  snippetGreetingLabel: { es: "Saludo de bienvenida", en: "Welcome greeting" },
  snippetGreetingBody: {
    es: "¡Hola! Gracias por escribirnos. ¿En qué te puedo ayudar?",
    en: "Hi! Thanks for reaching out. How can I help you?",
  },
  snippetThanksLabel: { es: "Agradecimiento", en: "Thank you" },
  snippetThanksBody: {
    es: "Muchas gracias por tu compra. Te avisamos en cuanto tu pedido salga del almacén.",
    en: "Thank you so much for your purchase. We'll let you know as soon as your order ships.",
  },
  sessionExpiredBanner: {
    es: "Sesión de 24 horas expirada. Usa una plantilla.",
    en: "The 24-hour session has expired. Use a template.",
  },
  metaSessionExpiredBanner: {
    es: "Meta cerró la ventana de respuesta humana. Espera a que el cliente vuelva a escribir.",
    en: "Meta's human reply window has closed. Wait for the customer to write again.",
  },
  metaHumanWindowHint: {
    es: "Tiempo disponible para que una persona responda desde la bandeja.",
    en: "Time available for a person to reply from the inbox.",
  },
  metaHumanWindowExpiredHint: {
    es: "Meta cerró la ventana de respuesta humana de 7 días.",
    en: "Meta's 7-day human reply window has closed.",
  },
  templates: { es: "Plantillas", en: "Templates" },
  quickSnippets: { es: "Atajos rápidos", en: "Quick snippets" },
  snippetHints: {
    es: "↑↓ navega · Enter inserta · Esc cierra",
    en: "↑↓ navigate · Enter inserts · Esc closes",
  },
  createSnippetCta: { es: 'Crear atajo "/{shortcut}"', en: 'Create shortcut "/{shortcut}"' },
  createSnippet: { es: "Crear atajo", en: "Create shortcut" },
  newSnippet: { es: "Nuevo atajo", en: "New shortcut" },
  deleteSnippet: { es: "Eliminar atajo", en: "Delete shortcut" },
  editSnippet: { es: "Editar atajo", en: "Edit shortcut" },
  editMessage: { es: "Editar mensaje", en: "Edit message" },
  editMessageTitle: { es: "Editar mensaje", en: "Edit message" },
  editMessageChatDesc: {
    es: "El cliente verá el texto nuevo en el chat.",
    en: "The customer will see the new text in the chat.",
  },
  editMessageCommentDesc: {
    es: "El comentario cambia en Facebook, a la vista de todos.",
    en: "The comment changes on Facebook, in public view.",
  },
  editMessageFailed: {
    es: "No se pudo editar el mensaje",
    en: "Couldn't edit the message",
  },
  messageEdited: { es: "Mensaje editado", en: "Message edited" },
  editedMark: { es: "editado", en: "edited" },
  snippetShortcutPlaceholder: { es: "atajo", en: "shortcut" },
  snippetBodyPlaceholder: {
    es: "Texto que se insertará…",
    en: "Text to insert…",
  },
  typeMessage: { es: "Escribe un mensaje", en: "Type a message" },
  sendTemplate: { es: "Enviar plantilla", en: "Send template" },
  dropAttachments: { es: "Suelta los archivos aquí", en: "Drop files here" },
  attachmentPreviews: { es: "Archivos para enviar", en: "Files to send" },
  removeNamedAttachment: { es: "Quitar {name}", en: "Remove {name}" },
  attachmentUnsupported: { es: "Este canal no admite ese tipo de archivo", en: "This channel does not support that file type" },
  tooManyAttachments: { es: "Puedes adjuntar hasta {count} archivos", en: "You can attach up to {count} files" },
  attachFile: { es: "Adjuntar archivo", en: "Attach file" },
  removeAttachment: { es: "Quitar adjunto", en: "Remove attachment" },
  fileTooLarge: { es: "El archivo supera 25 MB", en: "File exceeds 25 MB" },
  sendMessage: { es: "Enviar mensaje", en: "Send message" },
  improveText: { es: "Mejorar redacción", en: "Improve writing" },
  improveTextUndo: { es: "Deshacer", en: "Undo" },
  improveTextUnchanged: {
    es: "El texto ya estaba bien",
    en: "The text was already fine",
  },
  improveTextFailed: {
    es: "No se pudo mejorar el texto",
    en: "Couldn't improve the text",
  },
  draftReply: { es: "Generar respuesta", en: "Draft a reply" },
  draftReplyReady: { es: "Respuesta generada", en: "Reply drafted" },
  draftReplyFailed: {
    es: "No se pudo generar la respuesta",
    en: "Couldn't draft the reply",
  },

  // Respuesta propuesta por un agente en modo "aprobar cada mensaje"
  pendingReplyTitle: { es: "Respuesta lista", en: "Reply ready" },
  pendingReplyFrom: { es: "{name} propone", en: "{name} suggests" },
  pendingReplySend: { es: "Enviar", en: "Send" },
  pendingReplyDiscard: { es: "Descartar", en: "Discard" },
  pendingReplyFailed: {
    es: "No se pudo enviar la respuesta",
    en: "Couldn't send the reply",
  },
  pendingReplyBadge: { es: "Respuesta lista", en: "Reply ready" },
  composerExpiredPlaceholder: {
    es: "Sesión expirada. Usa una plantilla.",
    en: "Session expired. Use a template.",
  },
  metaComposerExpiredPlaceholder: {
    es: "Espera un nuevo mensaje del cliente.",
    en: "Wait for a new message from the customer.",
  },

  // Message thread — session window
  noCustomerMessages: {
    es: "Sin mensajes del cliente",
    en: "No messages from the customer",
  },
  sessionExpired: { es: "Expirada", en: "Expired" },
  hoursRemaining: { es: "{n}h restantes", en: "{n}h left" },
  minutesRemaining: { es: "{n}m restantes", en: "{n}m left" },
  // Qué es ese reloj. WhatsApp sólo deja escribir libre durante 24 h desde el
  // último mensaje del cliente; después hay que usar una plantilla aprobada.
  sessionWindowHint: {
    es: "Tiempo que queda para responder gratis y sin plantilla. Cuenta 24 h desde el último mensaje del cliente.",
    en: "Time left to reply for free without a template. It counts 24h from the customer's last message.",
  },
  sessionWindowExpiredHint: {
    es: "Pasaron 24 h desde el último mensaje del cliente: para escribirle hay que usar una plantilla aprobada.",
    en: "24h have passed since the customer's last message: to write you need an approved template.",
  },

  // Message thread — send / react / load
  sendFailed: { es: "No se envió: {reason}", en: "Not sent: {reason}" },
  channelDisconnectedAlert: {
    es: "Este canal está desconectado. Reconéctalo para enviar o recibir mensajes.",
    en: "This channel is disconnected. Reconnect it to send or receive messages.",
  },
  networkErrorReason: { es: "error de red", en: "network error" },
  reactFailed: { es: "No se reaccionó: {reason}", en: "Reaction failed: {reason}" },
  waitForSend: { es: "Espera a que se envíe", en: "Wait until it's sent" },
  loadOlder: { es: "Cargar más antiguos", en: "Load older" },
  loading: { es: "Cargando…", en: "Loading…" },
  loadOlderFailed: {
    es: "No se cargaron mensajes anteriores",
    en: "Couldn't load older messages",
  },

  // Message thread — author labels
  aiAssistant: { es: "Asistente IA", en: "AI assistant" },
  automation: { es: "Automatización", en: "Automation" },
  agent: { es: "Agente", en: "Agent" },

  // Etiqueta de ORIGEN sobre la burbuja: qué funcionalidad envió el mensaje
  // (migración 143). Sin esto un mensaje que el comercio no escribió no tenía
  // explicación ni forma de saber qué apagar.
  originAiAgent: { es: "Asistente IA", en: "AI assistant" },
  originAiFollowup: { es: "Seguimiento IA", en: "AI follow-up" },
  originCommentAi: { es: "Comentarios IA", en: "AI comments" },
  originCommentRule: { es: "Regla de comentarios", en: "Comment rule" },
  originIgOutreach: { es: "Prospección IA", en: "AI outreach" },
  originAutomation: { es: "Automatización", en: "Automation" },
  originFlow: { es: "Flujo", en: "Flow" },
  originBroadcast: { es: "Campaña", en: "Campaign" },
  originVoiceAgent: { es: "Agente de voz", en: "Voice agent" },
  originOrderUpdate: { es: "Aviso de pedido", en: "Order update" },
  originAutomated: { es: "Envío automático", en: "Automated send" },

  // Message thread — header, status, assignment
  status: { es: "Estado", en: "Status" },
  statusOpen: { es: "Abierta", en: "Open" },
  statusPending: { es: "Pendiente", en: "Pending" },
  statusClosed: { es: "Cerrada", en: "Closed" },
  assign: { es: "Asignar", en: "Assign" },
  assigned: { es: "Asignado", en: "Assigned" },
  assignFailed: { es: "No se asignó", en: "Couldn't assign" },
  noTeammates: { es: "Sin compañeros", en: "No teammates" },
  youSuffix: { es: " (yo)", en: " (me)" },
  removeAssignment: { es: "Quitar asignación", en: "Remove assignment" },
  backToConversations: {
    es: "Volver a conversaciones",
    en: "Back to conversations",
  },
  viewContactInfo: {
    es: "Ver información del contacto",
    en: "View contact info",
  },
  hideContactInfo: {
    es: "Ocultar información del contacto",
    en: "Hide contact info",
  },
  showContactInfo: {
    es: "Mostrar información del contacto",
    en: "Show contact info",
  },
  refresh: { es: "Actualizar", en: "Refresh" },

  // Message thread — AI toggle
  aiActive: { es: "Responde la IA", en: "AI is replying" },
  aiPaused: { es: "Respondes tú", en: "You reply" },
  aiWhoReplies: { es: "¿Quién responde en este chat?", en: "Who replies in this chat?" },
  aiActiveTooltip: {
    es: "En este chat contesta la IA. Toca para pausarla y responder tú.",
    en: "The AI answers this chat. Tap to pause it and reply yourself.",
  },
  aiPausedTooltip: {
    es: "En este chat la IA no contesta. Toca para que vuelva a responder.",
    en: "The AI doesn't answer this chat. Tap to let it reply again.",
  },
  // Por qué no contestó. El motivo se escribía en cada intento y no se leía
  // en ninguna pantalla: "¿por qué no contestó?" sólo se podía responder
  // mirando la base.
  aiSkipped: {
    es: "No contestó: {motivo}",
    en: "Didn't reply: {motivo}",
  },

  // Message thread — comment post context banner
  commentOnPost: {
    es: "Comentario en una publicación",
    en: "Comment on a post",
  },
  post: { es: "Publicación", en: "Post" },
  postFb: { es: "Post FB", en: "FB post" },
  postIg: { es: "Post IG", en: "IG post" },
  postTiktok: { es: "Video TikTok", en: "TikTok video" },
  viewPost: { es: "Ver publicación ↗", en: "View post ↗" },
  commentsCount: {
    es: "{n} comentarios en la publicación",
    en: "{n} comments on the post",
  },

  // Resizable pane
  resizePanel: { es: "Cambiar ancho del panel", en: "Resize panel" },

  // Inbox search box
  searchAll: {
    es: "Buscar en mensajes y conversaciones",
    en: "Search messages and conversations",
  },
  clear: { es: "Limpiar", en: "Clear" },

  // Template picker
  variables: { es: "Variables", en: "Variables" },
  noApprovedTemplates: {
    es: "No hay plantillas aprobadas",
    en: "No approved templates",
  },
  syncTemplatesHint: {
    es: "Sincroniza desde Ajustes → Plantillas.",
    en: "Sync from Settings → Templates.",
  },
  templateAutoOnly: {
    es: "Se envía automáticamente (botón con enlace dinámico).",
    en: "Sent automatically (dynamic-link button).",
  },
  searchTemplates: { es: "Buscar plantillas", en: "Search templates" },
  noTemplateResults: {
    es: "No hay plantillas que coincidan",
    en: "No matching templates",
  },
  continueTemplate: { es: "Continuar", en: "Continue" },
  editTemplateName: { es: "Editar nombre interno", en: "Edit internal name" },
  renameTemplate: { es: "Renombrar", en: "Rename" },
  templateInternalName: { es: "Nombre interno", en: "Internal name" },
  saveTemplateName: { es: "Guardar nombre", en: "Save name" },
  cancelTemplateName: { es: "Cancelar edición", en: "Cancel editing" },
  templateNameSaveFailed: {
    es: "No se pudo guardar el nombre interno",
    en: "Couldn't save the internal name",
  },
  templateCustomImage: { es: "Foto personalizada", en: "Custom photo" },
  templateImage: { es: "Foto para este cliente", en: "Photo for this customer" },
  templateImageRequired: {
    es: "Selecciona la imagen de esta plantilla.",
    en: "Select the image for this template.",
  },
  templateImageUploadFailed: {
    es: "No se pudo cargar la imagen.",
    en: "The image could not be uploaded.",
  },
  templateImageTypeError: {
    es: "Usa una imagen JPG o PNG",
    en: "Use a JPG or PNG image",
  },
  templateImageDrop: {
    es: "Arrastra una imagen aquí",
    en: "Drag an image here",
  },
  templateImageDropActive: {
    es: "Suelta la imagen aquí",
    en: "Drop the image here",
  },
  templateImagePaste: {
    es: "También puedes pegarla desde el portapapeles",
    en: "You can also paste it from the clipboard",
  },
  templateImageSelect: { es: "Seleccionar imagen", en: "Select image" },
  templateImageRequirements: {
    es: "JPG o PNG · máximo 25 MB",
    en: "JPG or PNG · up to 25 MB",
  },
  templateImageChange: { es: "Cambiar", en: "Change" },
  templateImageRemove: { es: "Quitar imagen", en: "Remove image" },
  templateCustomTextLabel: {
    es: "Texto personalizado",
    en: "Custom text",
  },
  templateCustomTextNumberedLabel: {
    es: "Texto personalizado {n}",
    en: "Custom text {n}",
  },
  templateCategoryUtility: { es: "Servicio", en: "Utility" },
  templateCategoryMarketing: { es: "Marketing", en: "Marketing" },
  templateCategoryAuthentication: {
    es: "Autenticación",
    en: "Authentication",
  },
  preview: { es: "Vista previa", en: "Preview" },
  variableLabel: { es: "Variable {{{n}}}", en: "Variable {{{n}}}" },
  variableExample: { es: "· ej. {sample}", en: "· e.g. {sample}" },
  back: { es: "Atrás", en: "Back" },
  send: { es: "Enviar", en: "Send" },

  // Escribirle al privado a quien comentó
  commentDmTitle: { es: "Escribir al privado", en: "Send a DM" },
  commentDmPlaceholder: {
    es: "Tu mensaje…",
    en: "Your message…",
  },
  commentDmSent: { es: "Mensaje enviado", en: "Message sent" },
  commentDmOpen: { es: "Ver conversación", en: "Open conversation" },
  commentDmFailed: {
    es: "No se pudo escribir al privado",
    en: "Couldn't send the DM",
  },

  // Shopify contact panel
  shopifyCustomer: { es: "Cliente Shopify", en: "Shopify customer" },
  viewInShopify: { es: "Ver en Shopify", en: "View in Shopify" },
  totalSpent: { es: "Total comprado", en: "Total spent" },
  orders: { es: "Pedidos", en: "Orders" },
  latestOrders: { es: "Últimos pedidos", en: "Latest orders" },
  viewOrder: { es: "Ver pedido", en: "View order" },
  viewOrderInShopify: { es: "Ver pedido en Shopify", en: "View order in Shopify" },
  viewCustomerInShopify: { es: "Ver cliente en Shopify", en: "View customer in Shopify" },
  viewAbandonedCart: { es: "Ver carrito abandonado", en: "View abandoned cart" },
  viewOrderInMercadoLibre: {
    es: "Ver venta en Mercado Libre",
    en: "View sale in Mercado Libre",
  },
  financialPaid: { es: "Pagado", en: "Paid" },
  financialPending: { es: "Pendiente", en: "Pending" },
  financialRefunded: { es: "Reembolsado", en: "Refunded" },
  financialPartiallyRefunded: {
    es: "Reembolsado parcial",
    en: "Partially refunded",
  },
  financialVoided: { es: "Anulado", en: "Voided" },
  financialAuthorized: { es: "Autorizado", en: "Authorized" },
  fulfillmentFulfilled: { es: "Enviado", en: "Fulfilled" },
  fulfillmentPartial: { es: "Enviado parcial", en: "Partially fulfilled" },
  fulfillmentRestocked: { es: "Repuesto", en: "Restocked" },
  fulfillmentUnfulfilled: { es: "Sin enviar", en: "Unfulfilled" },

  // Mercado Libre — pregunta (pública) vs mensaje (post-venta)
  mlQuestion: { es: "Pregunta", en: "Question" },
  mlMessage: { es: "Mensaje", en: "Message" },
  mlReview: { es: "Opinión", en: "Review" },
  mlFilterClaims: { es: "Reclamos", en: "Claims" },
  mlClaim: { es: "Reclamo", en: "Claim" },
  mlNoClaims: { es: "Sin reclamos abiertos", en: "No open claims" },
  mlNoClaimsHint: {
    es: "Un reclamo sin atender afecta tu reputación en Mercado Libre.",
    en: "An unattended claim hurts your Mercado Libre reputation.",
  },
  mlReviewPublic: { es: "Opinión de producto", en: "Product review" },
  mlFilterReviews: { es: "Opiniones", en: "Reviews" },
  mlReviewNoReply: {
    es: "Mercado Libre no permite responder opiniones",
    en: "Mercado Libre does not allow replying to reviews",
  },
  mlClaimMediation: { es: "Reclamo en mediación", en: "Claim under mediation" },
  mlClaimResolved: { es: "Reclamo resuelto", en: "Claim resolved" },
  mlClaimClosed: {
    es: "Reclamo cerrado: Mercado Libre ya no acepta mensajes",
    en: "Claim closed: Mercado Libre no longer accepts messages",
  },
  mlClaimAttachmentFailed: {
    es: "No se envió el archivo. Vuelve a adjuntarlo e inténtalo de nuevo",
    en: "The file wasn't sent. Attach it again and retry",
  },
  mlQuestionPublic: { es: "Pregunta pública", en: "Public question" },
  mlMessagePostSale: { es: "Mensaje post-venta", en: "Post-sale message" },
  mlFilterAll: { es: "Todas", en: "All" },
  mlFilterQuestions: { es: "Preguntas", en: "Questions" },
  mlFilterMessages: { es: "Mensajes", en: "Messages" },
} satisfies Namespace;
