import type { Namespace } from "./types";

/** Contacts area: list, detail, form, tags, segments and CSV import. */
export const contacts = {
  // Page header + tabs
  title: { es: "Contactos", en: "Contacts" },
  totalCount: { es: "{count} en total", en: "{count} total" },
  import: { es: "Importar", en: "Import" },
  addContact: { es: "Añadir contacto", en: "Add contact" },
  tabContacts: { es: "Contactos", en: "Contacts" },
  tabTags: { es: "Etiquetas", en: "Tags" },
  tabSegments: { es: "Segmentos", en: "Segments" },

  // Search + filters
  searchPlaceholder: {
    es: "Nombre, teléfono o correo",
    en: "Name, phone or email",
  },
  clear: { es: "Limpiar", en: "Clear" },

  // Table headers
  colName: { es: "Nombre", en: "Name" },
  colPhone: { es: "Teléfono", en: "Phone" },
  colEmail: { es: "Correo", en: "Email" },
  colCompany: { es: "Empresa", en: "Company" },
  colTags: { es: "Etiquetas", en: "Tags" },
  colCreated: { es: "Creado", en: "Created" },

  noName: { es: "Sin nombre", en: "No name" },
  shopifyCustomer: { es: "Cliente Shopify", en: "Shopify customer" },

  // Empty states
  noResults: { es: "Sin resultados.", en: "No results." },
  noContactsTitle: { es: "Aún no tienes contactos", en: "No contacts yet" },
  addFirstContact: {
    es: "Añadir tu primer contacto",
    en: "Add your first contact",
  },

  // Pagination
  paginationRange: {
    es: "Mostrando {from}-{to} de {total}",
    en: "Showing {from}-{to} of {total}",
  },
  pageOf: { es: "Página {page} de {total}", en: "Page {page} of {total}" },
  perPage: { es: "Por página:", en: "Per page:" },
  selectPage: { es: "Seleccionar página", en: "Select page" },
  selectOne: { es: "Seleccionar contacto", en: "Select contact" },
  selectedCount: { es: "{count} seleccionados", en: "{count} selected" },
  selectAllMatching: { es: "Seleccionar los {count}", en: "Select all {count}" },
  clearSelection: { es: "Quitar selección", en: "Clear selection" },
  exportCsv: { es: "Exportar CSV", en: "Export CSV" },
  exported: { es: "{count} contactos exportados", en: "{count} contacts exported" },
  exportError: { es: "No se pudo exportar", en: "Export failed" },
  shopTotalSpent: { es: "Total gastado", en: "Total spent" },
  shopOrders: { es: "Pedidos", en: "Orders" },
  shopAddress: { es: "Dirección", en: "Address" },
  shopCity: { es: "Ciudad", en: "City" },
  shopProvince: { es: "Provincia", en: "Province" },
  shopCountry: { es: "País", en: "Country" },
  shopZip: { es: "Código postal", en: "Zip code" },
  shopCurrency: { es: "Moneda", en: "Currency" },
  colChannel: { es: "Canal", en: "Channel" },
  exportColumnsTitle: { es: "Elige las columnas a exportar", en: "Choose columns to export" },
  exportColumnsHint: { es: "{count} contactos · marca las columnas del CSV", en: "{count} contacts · pick the CSV columns" },
  selectAllCols: { es: "Todas", en: "All" },
  selectNoneCols: { es: "Ninguna", en: "None" },
  saveAsSegment: { es: "Guardar como segmento", en: "Save as segment" },
  segmentSavedFromFilter: {
    es: "Segmento guardado desde el filtro",
    en: "Segment saved from filter",
  },

  // Row actions
  edit: { es: "Editar", en: "Edit" },
  delete: { es: "Eliminar", en: "Delete" },

  // Delete confirmation (page)
  deleteContactQuestion: {
    es: "¿Eliminar a {name}?",
    en: "Delete {name}?",
  },

  // Toasts (page)
  loadContactsError: {
    es: "No se cargaron los contactos",
    en: "Couldn't load contacts",
  },
  deleteContactError: {
    es: "No se pudo eliminar el contacto",
    en: "Couldn't delete the contact",
  },
  contactDeleted: { es: "Contacto eliminado", en: "Contact deleted" },

  // Contact form
  editContact: { es: "Editar contacto", en: "Edit contact" },
  newContact: { es: "Añadir contacto", en: "Add contact" },
  fieldName: { es: "Nombre", en: "Name" },
  fieldPhone: { es: "Teléfono", en: "Phone" },
  fieldEmail: { es: "Correo", en: "Email" },
  fieldCompany: { es: "Empresa", en: "Company" },
  phonePlaceholder: { es: "+57 300 123 4567", en: "+57 300 123 4567" },
  tagsLabel: { es: "Etiquetas", en: "Tags" },
  noTagsCreatePrefix: { es: "No hay etiquetas. Créalas en", en: "No tags yet. Create them in" },
  contactsTagsLink: { es: "Contactos → Etiquetas", en: "Contacts → Tags" },
  cancel: { es: "Cancelar", en: "Cancel" },
  create: { es: "Crear", en: "Create" },
  update: { es: "Actualizar", en: "Update" },
  contactCreated: { es: "Contacto creado", en: "Contact created" },
  contactUpdated: { es: "Contacto actualizado", en: "Contact updated" },
  missingPhone: { es: "Falta el teléfono", en: "Phone is required" },
  notAuthenticated: { es: "No autenticado", en: "Not authenticated" },
  saveContactError: {
    es: "No se pudo guardar el contacto",
    en: "Couldn't save the contact",
  },

  // Detail view
  unknown: { es: "Desconocido", en: "Unknown" },
  detailDetails: { es: "Detalles", en: "Details" },
  lastOfferTitle: { es: "Última oferta elegida", en: "Last offer chosen" },
  lastOfferUnits: { es: "{n} uds", en: "{n} u" },
  lastOfferNoLabel: { es: "Sin oferta específica", en: "No specific offer" },
  detailNotes: { es: "Notas", en: "Notes" },
  detailCustomFields: { es: "Campos personalizados", en: "Custom fields" },
  save: { es: "Guardar", en: "Save" },
  notePlaceholder: { es: "Escribe una nota...", en: "Write a note..." },
  addNote: { es: "Añadir", en: "Add" },
  noNotes: { es: "No hay notas.", en: "No notes yet." },
  noCustomFields: {
    es: "No hay campos personalizados.",
    en: "No custom fields yet.",
  },
  updateContactError: {
    es: "No se pudo actualizar el contacto",
    en: "Couldn't update the contact",
  },
  addNoteError: { es: "No se pudo añadir la nota", en: "Couldn't add the note" },
  noteAdded: { es: "Nota añadida", en: "Note added" },
  deleteNoteError: {
    es: "No se pudo eliminar la nota",
    en: "Couldn't delete the note",
  },
  noteDeleted: { es: "Nota eliminada", en: "Note deleted" },
  saved: { es: "Guardado", en: "Saved" },
  saveCustomFieldsError: {
    es: "No se pudieron guardar los campos personalizados",
    en: "Couldn't save the custom fields",
  },

  // Inline contact tags (popover)
  removeTag: { es: "Quitar {name}", en: "Remove {name}" },
  colorLabel: { es: "Color {color}", en: "Color {color}" },
  tagButton: { es: "Etiqueta", en: "Tag" },
  namePlaceholder: { es: "Nombre", en: "Name" },
  noTagsYet: { es: "Aún no hay etiquetas.", en: "No tags yet." },
  newTag: { es: "Nueva etiqueta", en: "New tag" },
  removeTagError: {
    es: "No se pudo quitar la etiqueta",
    en: "Couldn't remove the tag",
  },
  assignTagError: {
    es: "No se pudo asignar la etiqueta",
    en: "Couldn't assign the tag",
  },
  missingName: { es: "Falta el nombre.", en: "Name is required." },
  workspaceNotIdentified: {
    es: "No se pudo identificar el espacio de trabajo.",
    en: "Couldn't identify the workspace.",
  },
  createTagError: {
    es: "No se pudo crear la etiqueta",
    en: "Couldn't create the tag",
  },

  // Import modal
  importContacts: { es: "Importar contactos", en: "Import contacts" },
  importDescriptionPrefix: { es: "CSV con columna", en: "CSV with column" },
  importDescriptionOptional: { es: ". Opcionales:", en: ". Optional:" },
  importNoValidRows: {
    es: 'No se pudieron leer filas del archivo. Revisa que sea un CSV.',
    en: "Couldn't read rows from the file. Make sure it's a CSV.",
  },
  importIntro: {
    es: 'Sube un CSV (o tu Excel guardado como CSV). Después eliges qué columna corresponde a cada dato.',
    en: 'Upload a CSV (or your Excel saved as CSV). Then choose which column maps to each field.',
  },
  downloadTemplate: { es: 'Descargar plantilla', en: 'Download template' },
  templateFileName: { es: 'plantilla-contactos.csv', en: 'contacts-template.csv' },
  mapColumns: { es: 'Asignar columnas', en: 'Map columns' },
  columnNone: { es: '— Ninguna —', en: '— None —' },
  importNeedPhone: {
    es: 'Asigna la columna de teléfono para continuar.',
    en: 'Map the phone column to continue.',
  },
  skippedCount: { es: '{count} omitidos (ya existían)', en: '{count} skipped (already existed)' },
  importAllSkipped: {
    es: 'Todos ya existían ({count} omitidos)',
    en: 'All already existed ({count} skipped)',
  },
  importRowsDetected: {
    es: "{count} filas detectadas",
    en: "{count} rows detected",
  },
  uploadCsvPrompt: {
    es: "Haz clic para subir un CSV",
    en: "Click to upload a CSV",
  },
  preview: { es: "Vista previa", en: "Preview" },
  andMoreRows: { es: "...y {count} filas más", en: "...and {count} more rows" },
  importedCount: { es: "{count} importados", en: "{count} imported" },
  failedCount: { es: "{count} con error", en: "{count} failed" },
  importedToast: {
    es: "{count} contactos importados",
    en: "{count} contacts imported",
  },
  importFailedToast: {
    es: "No se pudo importar {count} contactos",
    en: "Couldn't import {count} contacts",
  },
  importFailed: { es: "Falló la importación", en: "Import failed" },
  close: { es: "Cerrar", en: "Close" },
  importCount: { es: "Importar {count} contactos", en: "Import {count} contacts" },
  importEmpty: { es: "Importar", en: "Import" },

  // Tags panel
  yourTags: { es: "Tus etiquetas", en: "Your tags" },
  yourTagsSubtitle: {
    es: "Sirven para segmentar contactos y mandar campañas a grupos específicos.",
    en: "Use them to segment contacts and send campaigns to specific groups.",
  },
  newTagButton: { es: "Nueva etiqueta", en: "New tag" },
  noTagsPanelTitle: {
    es: "Todavía no tienes etiquetas",
    en: "No tags yet",
  },
  noTagsPanelBody: {
    es: "Empieza creando una. Después la puedes asignar a contactos desde la lista o desde el chat.",
    en: "Start by creating one. You can then assign it to contacts from the list or from the chat.",
  },
  createTag: { es: "Crear etiqueta", en: "Create tag" },
  editTagAria: { es: "Editar etiqueta", en: "Edit tag" },
  deleteTagAria: { es: "Eliminar etiqueta", en: "Delete tag" },
  loadTagsError: {
    es: "No se pudieron cargar las etiquetas",
    en: "Couldn't load tags",
  },
  deleteTagError: {
    es: "No se pudo eliminar la etiqueta",
    en: "Couldn't delete the tag",
  },
  tagDeleted: { es: "Etiqueta eliminada", en: "Tag deleted" },
  deleteTagQuestion: {
    es: '¿Eliminar la etiqueta "{name}"?',
    en: 'Delete the "{name}" tag?',
  },
  deleteTagWithContacts: {
    es: "Se quitará de los {count} contactos que la tienen. Los contactos no se eliminan.",
    en: "It will be removed from the {count} contacts that have it. The contacts are not deleted.",
  },
  deleteTagNoContacts: {
    es: "Ningún contacto la tiene asignada, así que es seguro borrarla.",
    en: "No contact has it assigned, so it's safe to delete.",
  },
  editTag: { es: "Editar etiqueta", en: "Edit tag" },
  newTagTitle: { es: "Nueva etiqueta", en: "New tag" },
  tagNamePlaceholder: { es: "VIP, Mayorista, Lima…", en: "VIP, Wholesale, Lima…" },
  colorWord: { es: "Color", en: "Color" },
  tagNameRequired: {
    es: "Ponle un nombre a la etiqueta",
    en: "Give the tag a name",
  },
  workspaceUnavailable: {
    es: "Workspace no disponible",
    en: "Workspace unavailable",
  },
  saveError: { es: "No se pudo guardar", en: "Couldn't save" },
  tagUpdated: { es: "Etiqueta actualizada", en: "Tag updated" },
  createError: { es: "No se pudo crear", en: "Couldn't create" },
  tagCreated: { es: "Etiqueta creada", en: "Tag created" },

  // Segments panel
  savedSegments: { es: "Segmentos guardados", en: "Saved segments" },
  newSegment: { es: "Nuevo segmento", en: "New segment" },
  noSegments: { es: "No hay segmentos.", en: "No segments yet." },
  ruleCountSingular: { es: "{count} regla", en: "{count} rule" },
  ruleCountPlural: { es: "{count} reglas", en: "{count} rules" },
  matchesAll: { es: "coincide con todas", en: "matches all" },
  matchesAny: { es: "coincide con alguna", en: "matches any" },
  deleteSegmentConfirm: {
    es: "¿Eliminar este segmento?",
    en: "Delete this segment?",
  },
  deleteSegmentError: {
    es: "No se pudo eliminar: {error}",
    en: "Couldn't delete: {error}",
  },
  segmentDeleted: { es: "Segmento eliminado", en: "Segment deleted" },
  editSegment: { es: "Editar segmento", en: "Edit segment" },
  segmentNamePlaceholder: {
    es: "VIPs · Última semana · Bogotá",
    en: "VIPs · Last week · Bogotá",
  },
  fieldDescription: { es: "Descripción", en: "Description" },
  segmentDescriptionPlaceholder: {
    es: "Clientes que compraron en los últimos 30 días",
    en: "Customers who purchased in the last 30 days",
  },
  matchLabel: { es: "Coincidencia", en: "Match" },
  matchAllTitle: { es: "Cumple todas", en: "Match all" },
  matchAllSubtitle: {
    es: "Estilo Y: aplica solo si todas las reglas pasan.",
    en: "AND style: applies only if every rule passes.",
  },
  matchAnyTitle: { es: "Cumple alguna", en: "Match any" },
  matchAnySubtitle: {
    es: "Estilo O: basta con una regla.",
    en: "OR style: a single rule is enough.",
  },
  rules: { es: "Reglas", en: "Rules" },
  previewOf: {
    es: "de {total} contactos de tu equipo",
    en: "of {total} contacts on your team",
  },
  segmentNoName: { es: "Sin nombre", en: "No name" },
  noContactMatches: {
    es: "Ningún contacto coincide.",
    en: "No contact matches.",
  },
  morePreview: { es: "+{count} más…", en: "+{count} more…" },
  saveSegmentError: {
    es: "No se pudo guardar: {error}",
    en: "Couldn't save: {error}",
  },
  segmentUpdated: { es: "Segmento actualizado", en: "Segment updated" },
  segmentCreated: { es: "Segmento creado", en: "Segment created" },
  addRule: { es: "Añadir regla", en: "Add rule" },
  removeRule: { es: "Quitar regla", en: "Remove rule" },
  noTagsRule: { es: "No hay etiquetas.", en: "No tags." },
  noCustomFieldsRule: {
    es: "No hay campos personalizados.",
    en: "No custom fields.",
  },
  noCustomFieldsHint: {
    es: " (no tienes campos personalizados)",
    en: " (you have no custom fields)",
  },

  // Channel labels
  channelFbComment: {
    es: "Comentarios de Facebook",
    en: "Facebook comments",
  },
  channelIgComment: {
    es: "Comentarios de Instagram",
    en: "Instagram comments",
  },
  channelTiktokComment: {
    es: "Comentarios de TikTok",
    en: "TikTok comments",
  },

  // Rule type labels + descriptions
  ruleTagLabel: { es: "Etiqueta", en: "Tag" },
  ruleTagDesc: {
    es: "Tiene o no tiene una etiqueta.",
    en: "Has or doesn't have a tag.",
  },
  ruleChannelLabel: { es: "Canal", en: "Channel" },
  ruleChannelDesc: {
    es: "El contacto llegó por WhatsApp, Instagram, etc.",
    en: "The contact came in via WhatsApp, Instagram, etc.",
  },
  ruleCreatedLabel: { es: "Fecha de creación", en: "Created date" },
  ruleCreatedDesc: {
    es: "Cuándo se creó el contacto.",
    en: "When the contact was created.",
  },
  ruleTextLabel: { es: "Texto del contacto", en: "Contact text" },
  ruleTextDesc: {
    es: "El nombre, correo, teléfono o empresa contiene algo.",
    en: "The name, email, phone or company contains something.",
  },
  ruleHasFieldLabel: { es: "Tiene dato", en: "Has field" },
  ruleHasFieldDesc: {
    es: "Si el contacto tiene cargado un campo.",
    en: "Whether the contact has a field filled in.",
  },
  ruleCustomFieldLabel: { es: "Campo personalizado", en: "Custom field" },
  ruleCustomFieldDesc: {
    es: "Filtra por un campo que tú creaste.",
    en: "Filter by a field you created.",
  },
  ruleShopifyLabel: { es: "Cliente Shopify", en: "Shopify customer" },
  ruleShopifyDesc: {
    es: "Si el contacto compró o no en Shopify.",
    en: "Whether the contact is a Shopify customer.",
  },
  ruleOfferLabel: { es: "Oferta elegida", en: "Offer chosen" },
  ruleOfferDesc: {
    es: "La oferta que compró (ej. 3+1 gratis).",
    en: "The offer they bought (e.g. 3+1 free).",
  },
  ruleUnitsLabel: { es: "Unidades compradas", en: "Units purchased" },
  ruleUnitsDesc: {
    es: "Cuántas unidades compró en su último pedido.",
    en: "How many units they bought in their last order.",
  },
  ruleSpendLabel: { es: "Total gastado", en: "Total spent" },
  ruleSpendDesc: {
    es: "Cuánto gastó en total (histórico de Shopify).",
    en: "How much they spent in total (Shopify history).",
  },
  ruleOrdersLabel: { es: "Pedidos totales", en: "Total orders" },
  ruleOrdersDesc: {
    es: "Cuántos pedidos hizo en total (histórico de Shopify).",
    en: "How many orders they placed in total (Shopify history).",
  },
  ruleLocationLabel: { es: "Ubicación", en: "Location" },
  ruleLocationDesc: {
    es: "País o ciudad de la dirección de Shopify.",
    en: "Country or city from the Shopify address.",
  },
  opSpendGte: { es: "gastó al menos", en: "spent at least" },
  opSpendLte: { es: "gastó como mucho", en: "spent at most" },
  opSpendBetween: { es: "gastó entre", en: "spent between" },
  opOrdersEq: { es: "pedidos =", en: "orders =" },
  opOrdersGte: { es: "al menos", en: "at least" },
  opOrdersLte: { es: "como mucho", en: "at most" },
  opOrdersBetween: { es: "entre", en: "between" },
  opLocationIs: { es: "es", en: "is" },
  opLocationContains: { es: "contiene", en: "contains" },
  locationCountry: { es: "País", en: "Country" },
  locationCity: { es: "Ciudad", en: "City" },
  locationPlaceholder: { es: "ej. Argentina", en: "e.g. Argentina" },
  ruleActivityDateLabel: { es: "Fecha de actividad", en: "Activity date" },
  ruleActivityDateDesc: {
    es: "Última compra, última actividad o última conversación con la IA.",
    en: "Last purchase, last activity, or last AI conversation.",
  },
  actFieldLastPurchase: { es: "última compra", en: "last purchase" },
  actFieldLastActivity: { es: "última actividad", en: "last activity" },
  actFieldLastAi: { es: "última conversación IA", en: "last AI conversation" },

  // Field labels (segment rules)
  segFieldName: { es: "Nombre", en: "Name" },
  segFieldEmail: { es: "Correo", en: "Email" },
  segFieldPhone: { es: "Teléfono", en: "Phone" },
  segFieldCompany: { es: "Empresa", en: "Company" },

  // Operator labels
  opTagHas: { es: "tiene", en: "has" },
  opTagNotHas: { es: "no tiene", en: "doesn't have" },
  opChannelIs: { es: "es", en: "is" },
  opChannelIsNot: { es: "no es", en: "is not" },
  opCreatedLastNDays: {
    es: "hace menos de (días)",
    en: "within the last (days)",
  },
  opCreatedAfter: { es: "después de", en: "after" },
  opCreatedBefore: { es: "antes de", en: "before" },
  opHasFieldPresent: { es: "está cargado", en: "is filled in" },
  opHasFieldMissing: { es: "está vacío", en: "is empty" },
  opTextContains: { es: "contiene", en: "contains" },
  opTextEquals: { es: "es exactamente", en: "is exactly" },
  opTextStartsWith: { es: "empieza con", en: "starts with" },
  opCustomEquals: { es: "es", en: "is" },
  opCustomNotEquals: { es: "no es", en: "is not" },
  opCustomContains: { es: "contiene", en: "contains" },
  opShopifyIsCustomer: { es: "es cliente", en: "is a customer" },
  opShopifyIsNotCustomer: { es: "no es cliente", en: "is not a customer" },
  opOfferIs: { es: "es", en: "is" },
  opOfferIsNot: { es: "no es", en: "is not" },
  opOfferContains: { es: "contiene", en: "contains" },
  opOfferAny: { es: "eligió alguna", en: "chose any" },
  opUnitsEq: { es: "es igual a", en: "equals" },
  opUnitsGte: { es: "es al menos", en: "is at least" },
  opUnitsLte: { es: "es como máximo", en: "is at most" },
  opUnitsBetween: { es: "entre", en: "between" },

  // Rule control words + placeholders
  theWord: { es: "El", en: "The" },
  daysWord: { es: "días", en: "days" },
  tagPlaceholder: { es: "Etiqueta…", en: "Tag…" },
  fieldPlaceholder: { es: "Campo…", en: "Field…" },
  textPlaceholder: { es: "texto", en: "text" },
  valuePlaceholder: { es: "valor", en: "value" },
  offerPlaceholder: { es: "oferta…", en: "offer…" },
  unitsAndWord: { es: "y", en: "and" },

  // Activity timeline (contact detail)
  tabActivity: { es: "Actividad", en: "Activity" },
  actEmpty: { es: "Sin actividad todavía.", en: "No activity yet." },
  actRangeAll: { es: "Todo", en: "All" },

  // Filtro por señal (de dónde viene la persona / si se le puede escribir)
  signalAll: { es: "Cualquier señal", en: "Any signal" },
  signalStory: {
    es: "Respondieron una historia",
    en: "Replied to a story",
  },
  signalCommenters: { es: "Comentaron", en: "Commented" },
  signalCustomers: { es: "Ya compraron", en: "Already bought" },
  actRange7: { es: "7 días", en: "7 days" },
  actRange30: { es: "30 días", en: "30 days" },
  actRange90: { es: "90 días", en: "90 days" },
  actOrder: { es: "Pedido", en: "Order" },
  actCart: { es: "Carrito abandonado", en: "Abandoned cart" },
  actMessageIn: { es: "Mensaje recibido", en: "Message received" },
  actMessageOut: { es: "Mensaje enviado", en: "Message sent" },
  actBroadcast: { es: "Campaña", en: "Campaign" },
  actAutomation: { es: "Automatización", en: "Automation" },
  actTag: { es: "Etiqueta añadida", en: "Tag added" },
  actNote: { es: "Nota", en: "Note" },
  actFlow: { es: "Flujo", en: "Flow" },
} satisfies Namespace;
