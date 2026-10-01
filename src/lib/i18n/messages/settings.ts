import type { Namespace } from './types';

/** Settings page: tabs, appearance and the language picker. */
export const settings = {
  installTitle: { es: 'Riverz en tu dispositivo', en: 'Riverz on your device' },
  installBody: { es: 'Abre tu bandeja desde un acceso propio y conserva las herramientas de tu negocio.', en: 'Open your inbox from a dedicated shortcut and keep your business tools available.' },
  installButton: { es: 'Instalar Riverz', en: 'Install Riverz' },
  installReady: { es: 'Este navegador ofrece la instalación. Tú decides cuándo abrirla.', en: 'This browser offers installation. You choose when to open it.' },
  installPrompting: { es: 'Responde al aviso de instalación del navegador.', en: 'Respond to the browser installation prompt.' },
  installAccepted: { es: 'Aceptaste la instalación. Espera a que el dispositivo la termine.', en: 'You accepted installation. Wait for your device to finish it.' },
  installDismissed: { es: 'Cerraste el aviso. Puedes usar el menú del navegador para instalar más adelante.', en: 'You dismissed the prompt. You can use the browser menu to install later.' },
  installFailed: { es: 'No se pudo abrir la instalación. Inténtalo desde el menú del navegador.', en: 'Could not open installation. Try from the browser menu.' },
  installInstalled: { es: 'Riverz está instalado o abierto como aplicación en este dispositivo.', en: 'Riverz is installed or open as an app on this device.' },
  installIos: { es: 'En iPhone o iPad, abre Compartir y elige Añadir a pantalla de inicio. Si no aparece, abre Riverz en Safari.', en: 'On iPhone or iPad, open Share and choose Add to Home Screen. If unavailable, open Riverz in Safari.' },
  installBrowser: { es: 'Busca Instalar aplicación o Añadir a pantalla de inicio en el menú del navegador. Si no aparece, continúa usando Riverz aquí; la compatibilidad depende del dispositivo y del navegador.', en: 'Look for Install app or Add to Home Screen in the browser menu. If unavailable, continue using Riverz here; support depends on your device and browser.' },
  installConnection: { es: 'Necesitas conexión a Internet e iniciar sesión. Instalar Riverz no activa notificaciones.', en: 'An Internet connection and sign-in are required. Installing Riverz does not enable notifications.' },
  installAppName: { es: 'Riverz — Tu superasistente de negocio', en: 'Riverz — Your business superassistant' },
  installAppDescription: { es: 'Atiende conversaciones y revisa tu negocio con tu superasistente de IA.', en: 'Handle conversations and review your business with your AI superassistant.' },
  walletChargedOperations: {
    es: '{count} cargos de consumo',
    en: '{count} usage charges',
  },
  walletServiceTitle: {
    es: 'Atención y mensajes enviados',
    en: 'Service and sent messages',
  },
  walletLoadFailed: {
    es: 'No se pudo cargar el saldo y su desglose.',
    en: 'Could not load the balance and its breakdown.',
  },
  walletRetry: { es: 'Reintentar', en: 'Retry' },
  walletServiceNote: {
    es: 'Envíos confirmados del período, independientes de los cargos de consumo. Los comentarios están incluidos en los mensajes.',
    en: 'Confirmed sends in this period, independent of usage charges. Comments are included in messages.',
  },
  walletServiceContacts: { es: 'Contactos atendidos', en: 'Contacts served' },
  walletServiceAiContacts: {
    es: 'Contactos atendidos por IA',
    en: 'Contacts served by AI',
  },
  walletServiceAi: { es: 'Mensajes de IA', en: 'AI messages' },
  walletServiceAutomations: { es: 'Automatizaciones', en: 'Automations' },
  walletServiceHuman: { es: 'Mensajes manuales', en: 'Manual messages' },
  walletServiceOther: { es: 'Otros envíos', en: 'Other sends' },
  walletServiceComments: {
    es: 'Respuestas públicas a comentarios',
    en: 'Comment replies',
  },
  walletServicePanel: { es: 'Uso del panel', en: 'App usage' },
  walletOriginCalls: { es: 'Llamadas y telefonía', en: 'Calls and telephony' },
  walletActivityTikTokComments: {
    es: 'Comentarios de TikTok',
    en: 'TikTok comments',
  },
  walletOtherService: { es: 'Otros servicios', en: 'Other services' },
  walletEnabled: { es: 'Activada', en: 'Enabled' },
  walletDisabled: { es: 'Desactivada', en: 'Disabled' },
  walletUsageDetails: { es: 'Detalle del consumo', en: 'Usage breakdown' },
  walletBreakdownView: { es: 'Agrupar por', en: 'Group by' },
  walletViewService: { es: 'Servicio', en: 'Service' },
  walletViewChannel: { es: 'Origen', en: 'Source' },
  walletHistoricalIncomplete: {
    es: 'Detalle incompleto del historial',
    en: 'Incomplete historical detail',
  },
  walletHistoricalIncluded: {
    es: 'Incluido en el total. El registro original no guardó su origen.',
    en: 'Included in the total. The original record did not save its source.',
  },
  walletPeriodTotal: { es: 'Total del período', en: 'Period total' },
  walletPeriod: { es: 'Período', en: 'Period' },
  walletFromDate: { es: 'Desde', en: 'From' },
  walletToDate: { es: 'Hasta', en: 'To' },
  walletMovementFilter: {
    es: 'Filtrar movimientos',
    en: 'Filter transactions',
  },
  walletAllServices: { es: 'Todos los servicios', en: 'All services' },
  walletServiceUnknownNote: {
    es: 'Estos cargos históricos no guardaron el canal de origen. Se conservan en el total, sin asignarlos por estimación.',
    en: 'These historical charges did not record their source channel. They remain in the total without estimated attribution.',
  },
  walletActivity: {
    es: 'Consumo cobrado por canal',
    en: 'Billed usage by channel',
  },
  walletChargeJustification: {
    es: 'Justificación del consumo',
    en: 'Usage explanation',
  },
  walletChargeJustificationNote: {
    es: 'Abre cada fila para ver qué se procesó y cuánto se cobró. Los mensajes y los cargos son medidas diferentes.',
    en: 'Open each row to see what was processed and charged. Messages and charges are different measures.',
  },
  walletChannelOrService: { es: 'Canal o servicio', en: 'Channel or service' },
  walletServiceRecordedOnly: {
    es: 'El registro conserva el servicio y su consumo. El canal original no quedó guardado.',
    en: 'The record preserves the service and its usage. The original channel was not saved.',
  },
  walletRecordedServiceWork: {
    es: 'Consumo medido para «{service}».',
    en: 'Measured usage for “{service}”.',
  },
  walletMeasuredSeconds: {
    es: '{n} segundos procesados',
    en: '{n} seconds processed',
  },
  walletInspectCharges: { es: 'Ver cargos', en: 'View charges' },
  walletClearSource: {
    es: 'Quitar filtro de canal',
    en: 'Clear channel filter',
  },
  walletUpdatedAt: { es: 'Actualizado a las {time}', en: 'Updated at {time}' },
  walletOpenConversation: { es: 'Abrir conversación', en: 'Open conversation' },
  walletBalanceBreakdown: {
    es: 'Saldo total: {total} · {reserved} reservado para operaciones en curso.',
    en: 'Total balance: {total} · {reserved} reserved for ongoing operations.',
  },
  walletReasonReply: {
    es: 'Procesar el contexto del cliente y generar una respuesta.',
    en: 'Process customer context and generate a reply.',
  },
  walletReasonClassify: {
    es: 'Interpretar lo que pidió el cliente y decidir la siguiente acción.',
    en: 'Interpret the customer request and decide the next action.',
  },
  walletReasonMemory: {
    es: 'Resumir la conversación para conservar su contexto.',
    en: 'Summarize the conversation to preserve its context.',
  },
  walletReasonFollowup: {
    es: 'Preparar un mensaje de seguimiento.',
    en: 'Prepare a follow-up message.',
  },
  walletReasonAssist: {
    es: 'Generar o revisar contenido con la asistencia de la IA.',
    en: 'Generate or review content with AI assistance.',
  },
  walletReasonOperator: {
    es: 'Procesar una solicitud del equipo y ejecutar sus herramientas.',
    en: 'Process a team request and run its tools.',
  },
  walletReasonTranscribe: {
    es: 'Convertir audio o video en texto.',
    en: 'Convert audio or video into text.',
  },
  walletReasonPost: {
    es: 'Analizar una publicación o anuncio para contextualizar las respuestas.',
    en: 'Analyze a post or ad to provide context for replies.',
  },
  walletReasonImage: {
    es: 'Analizar una imagen enviada por el cliente.',
    en: 'Analyze an image sent by the customer.',
  },
  walletReasonCallAI: {
    es: 'Procesar el contexto y generar respuestas durante una llamada.',
    en: 'Process context and generate replies during a call.',
  },
  walletReasonCall: {
    es: 'Consumo medido de una llamada telefónica.',
    en: 'Measured telephone call usage.',
  },
  walletReasonPhone: {
    es: 'Alta o renovación del número de teléfono del comercio.',
    en: 'Activation or renewal of the business phone number.',
  },
  walletReasonVoice: {
    es: 'Convertir una respuesta en audio.',
    en: 'Convert a reply into audio.',
  },
  walletReasonSearch: {
    es: 'Consultar información en internet.',
    en: 'Look up information on the internet.',
  },
  walletReasonResearch: {
    es: 'Investigar información para completar una solicitud.',
    en: 'Research information to complete a request.',
  },
  walletReasonPage: {
    es: 'Leer una página para obtener información solicitada.',
    en: 'Read a page to retrieve requested information.',
  },
  walletReasonProfile: {
    es: 'Consultar el perfil público de un contacto.',
    en: 'Look up a contact public profile.',
  },
  walletActivityNote: {
    es: 'Solo descuentos reales del saldo. Un cargo no equivale a un mensaje enviado.',
    en: 'Actual wallet debits only. A charge does not equal a sent message.',
  },
  walletActivityChannel: { es: 'Canal', en: 'Channel' },
  walletActivityContacts: {
    es: 'Contactos con consumo cobrado',
    en: 'Contacts with billed usage',
  },
  walletActivityCharges: { es: 'Cargos de consumo', en: 'Usage charges' },
  walletActivityCharged: {
    es: 'Descontado del saldo',
    en: 'Debited from balance',
  },
  walletActivityAuto: { es: 'Mensajes automáticos', en: 'Automated messages' },
  walletActivitySent: { es: 'Total enviado', en: 'Total sent' },
  walletActivityTotal: { es: 'Total', en: 'Total' },
  walletActivityOther: {
    es: 'Sin canal identificado',
    en: 'No identified channel',
  },
  walletActivityFbComments: {
    es: 'Comentarios de Facebook',
    en: 'Facebook comments',
  },
  walletActivityIgComments: {
    es: 'Comentarios de Instagram',
    en: 'Instagram comments',
  },
  walletActivityWeb: { es: 'Chat web', en: 'Web chat' },
  walletPurposeReply: { es: 'Respuesta al cliente', en: 'Customer reply' },
  walletPurposeRewrite: {
    es: 'Revisión de una respuesta',
    en: 'Reply revision',
  },
  walletPurposeClosure: {
    es: 'Comprobar si el cliente necesita respuesta',
    en: 'Check whether the customer needs a reply',
  },
  walletPurposeEscalation: {
    es: 'Evaluar si necesita atención humana',
    en: 'Assess need for human attention',
  },
  walletPurposeEscalationNote: {
    es: 'Preparar aviso para el equipo',
    en: 'Prepare team notification',
  },
  walletAdjustments: { es: 'Ajustes de saldo', en: 'Balance adjustments' },
  walletProcessedTokens: {
    es: '{n} tokens procesados',
    en: '{n} tokens processed',
  },
  webhooksTitle: { es: 'Webhooks', en: 'Webhooks' },
  webhooksDescription: {
    es: 'Envía eventos de Riverz a tus automatizaciones.',
    en: 'Send Riverz events to your automations.',
  },
  webhookNew: { es: 'Nuevo webhook', en: 'New webhook' },
  webhookName: { es: 'Nombre del webhook', en: 'Webhook name' },
  webhookUrl: { es: 'URL de destino', en: 'Destination URL' },
  webhookEventsLabel: { es: 'Eventos', en: 'Events' },
  webhookConfigure: { es: 'Configurar', en: 'Configure' },
  webhookManage: { es: 'Administrar', en: 'Manage' },
  webhookModalDescription: {
    es: 'Conecta Make, Zapier, n8n o cualquier URL HTTPS.',
    en: 'Connect Make, Zapier, n8n or any HTTPS URL.',
  },
  webhookConnectedCount: {
    es: '{count} configurados',
    en: '{count} configured',
  },
  webhookEmpty: {
    es: 'Todavía no hay webhooks.',
    en: 'No webhooks yet.',
  },
  webhookCopied: { es: 'Copiado', en: 'Copied' },
  webhookInvalid: {
    es: 'Revisa el nombre, la URL HTTPS y los eventos.',
    en: 'Check the name, HTTPS URL and events.',
  },
  webhookSecretTitle: { es: 'Guarda este secreto', en: 'Save this secret' },
  webhookSecretDescription: {
    es: 'Solo se muestra una vez. Úsalo para validar la firma HMAC SHA-256.',
    en: 'It is shown only once. Use it to validate the HMAC SHA-256 signature.',
  },
  webhookEvents: { es: 'eventos', en: 'events' },
  webhookSendTest: { es: 'Enviar prueba', en: 'Send test' },
  webhookTestSent: { es: 'Prueba enviada', en: 'Test sent' },
  webhookTestUncertain: { es: 'No se pudo confirmar la prueba y su registro. Revisa el destino antes de repetirla.', en: 'Could not confirm the test and its receipt. Check the destination before repeating it.' },
  webhookTestMissing: { es: 'El webhook no existe o está desactivado.', en: 'The webhook does not exist or is disabled.' },
  webhookTestFailed: { es: 'El destino no confirmó la prueba. Revisa el registro y la URL HTTPS pública.', en: 'The destination did not acknowledge the test. Check the receipt and public HTTPS URL.' },
  webhookDeleted: { es: 'Webhook eliminado', en: 'Webhook deleted' },
  title: { es: 'Ajustes', en: 'Settings' },
  integrations: { es: 'Integraciones', en: 'Integrations' },
  addressValidationTitle: {
    es: 'Direcciones con Google Maps',
    en: 'Google Maps addresses',
  },
  addressValidationDescription: {
    es: 'Verifica la dirección antes de crear un pedido contraentrega.',
    en: 'Verify the address before creating a cash-on-delivery order.',
  },
  addressValidationApiKey: {
    es: 'API key de Google Maps',
    en: 'Google Maps API key',
  },
  addressValidationActive: { es: 'Activo', en: 'Active' },
  addressValidationInactive: { es: 'Inactivo', en: 'Inactive' },
  addressValidationToggle: {
    es: 'Verificar direcciones',
    en: 'Verify addresses',
  },
  addressValidationReplaceKey: {
    es: 'Reemplazar API key',
    en: 'Replace API key',
  },
  addressValidationKeyRequired: {
    es: 'Ingresa la API key.',
    en: 'Enter the API key.',
  },
  addressValidationSaveError: {
    es: 'No se pudo guardar.',
    en: "Couldn't save.",
  },
  addressValidationConfigured: {
    es: 'Verificación configurada',
    en: 'Address verification configured',
  },
  addressValidationEnabled: {
    es: 'Verificación activada',
    en: 'Address verification enabled',
  },
  addressValidationDisabled: {
    es: 'Verificación desactivada',
    en: 'Address verification disabled',
  },

  // Tabs
  tabProfile: { es: 'Perfil', en: 'Profile' },
  tabWorkspace: { es: 'Equipo', en: 'Team' },
  tabAppearance: { es: 'Apariencia', en: 'Appearance' },

  // Appearance
  appearance: { es: 'Apariencia', en: 'Appearance' },
  themeLight: { es: 'Claro', en: 'Light' },
  themeLightTagline: {
    es: 'Crema editorial: superficies cálidas, tinta carbón, acento lima.',
    en: 'Editorial cream: warm surfaces, charcoal ink, lime accent.',
  },
  themeDark: { es: 'Oscuro', en: 'Dark' },
  themeDarkTagline: {
    es: 'Carbón profundo: ideal para sesiones largas y poca luz.',
    en: 'Deep charcoal: built for long sessions and low light.',
  },
  useTheme: { es: 'Usar el tema {name}', en: 'Use the {name} theme' },
  themeId: { es: 'ID del tema: {id}', en: 'Theme ID: {id}' },

  // Language
  language: { es: 'Idioma', en: 'Language' },
  useLanguage: { es: 'Usar {name}', en: 'Use {name}' },

  // Settings page header
  backToSettings: { es: 'Volver a Ajustes', en: 'Back to Settings' },
  configuration: { es: 'Configuración', en: 'Configuration' },

  // Píxel de Meta. La descripción dice el PROBLEMA y no la tecnología: quien
  // vende contra-entrega no busca "API de Conversiones", busca por qué sus
  // ventas no aparecen en el administrador de anuncios.
  metaPixelTitle: { es: 'Píxel de Meta', en: 'Meta Pixel' },
  metaPixelDescription: {
    es: 'Las ventas del chat no pasan por el checkout. Con esto Meta las ve y tus campañas optimizan con datos reales.',
    en: 'Chat sales never reach the checkout. This reports them so your campaigns optimize on real data.',
  },
  metaPixelIdPlaceholder: { es: 'ID del píxel', en: 'Pixel ID' },
  metaPixelTokenPlaceholder: {
    es: 'Token de la API de Conversiones',
    en: 'Conversions API access token',
  },
  metaPixelConnected: { es: 'Píxel conectado', en: 'Pixel connected' },
  metaPixelDisconnect: { es: 'Desconectar el píxel', en: 'Disconnect pixel' },
  metaPixelDisconnected: { es: 'Píxel desconectado', en: 'Pixel disconnected' },
  // El número es lo único que distingue un píxel que funciona de uno conectado
  // con el token vencido: los dos dicen "conectado".
  metaPixelCounted: {
    es: '{n} ventas contadas · 30 días',
    en: '{n} sales counted · 30 days',
  },
  metaPixelNoneYet: {
    es: 'Todavía sin ventas que contar',
    en: 'No sales to report yet',
  },
  metaPixelPending: { es: '{n} sin enviar', en: '{n} not sent' },
  // Al conectar se recupera lo de la semana anterior, que es el limite de Meta.
  metaPixelRecovered: {
    es: 'Recuperamos {n} ventas de los últimos 7 días',
    en: 'Recovered {n} sales from the last 7 days',
  },

  // Klaviyo card
  klaviyoDescription: {
    es: 'Tus contactos y lo que compran, en tu lista. Sus segmentos, aquí como etiquetas.',
    en: 'Your contacts and what they buy, in your list. Their segments, here as tags.',
  },
  klaviyoHookHint: {
    es: 'Pega esta URL en la acción "Webhook" de un flujo de Klaviyo para que ese flujo mande un WhatsApp. En el cuerpo: phone, template y variables.',
    en: 'Paste this URL into a Klaviyo flow\'s "Webhook" action so that flow sends a WhatsApp. Body: phone, template and variables.',
  },
  klaviyoHookCopy: { es: 'Copiar URL', en: 'Copy URL' },
  klaviyoHookCopied: { es: 'URL copiada', en: 'URL copied' },
  connected: { es: 'Conectado', en: 'Connected' },
  klaviyoInvalidKey: {
    es: 'Pega una API key válida de Klaviyo.',
    en: 'Paste a valid Klaviyo API key.',
  },
  klaviyoConnectError: {
    es: 'No se pudo conectar Klaviyo',
    en: "Couldn't connect Klaviyo",
  },
  klaviyoConnected: { es: 'Klaviyo conectado', en: 'Klaviyo connected' },
  networkError: { es: 'Error de red', en: 'Network error' },
  disconnectError: { es: 'No se pudo desconectar', en: "Couldn't disconnect" },
  connectionsLoadError: {
    es: 'No se pudieron cargar tus conexiones',
    en: "Couldn't load your connections",
  },
  klaviyoDisconnected: {
    es: 'Klaviyo desconectado',
    en: 'Klaviyo disconnected',
  },

  // Mercado Pago card
  mpDescription: {
    es: 'Trae los pagos rechazados para escribirle por WhatsApp a quien no llegó a comprar.',
    en: "Pulls declined payments so you can WhatsApp the people who didn't get to buy.",
  },
  mpInvalidToken: {
    es: 'Pega tu Access Token de producción de Mercado Pago.',
    en: 'Paste your Mercado Pago production Access Token.',
  },
  mpConnectError: {
    es: 'No se pudo conectar Mercado Pago',
    en: "Couldn't connect Mercado Pago",
  },
  mpConnected: { es: 'Mercado Pago conectado', en: 'Mercado Pago connected' },
  mpDisconnected: {
    es: 'Mercado Pago desconectado',
    en: 'Mercado Pago disconnected',
  },
  mpNotifyUrlLabel: {
    es: 'Pega esta URL en Mercado Pago → Tus integraciones → Webhooks, evento "Pagos", para que los rechazos lleguen al instante.',
    en: 'Paste this URL in Mercado Pago → Your integrations → Webhooks, event "Payments", so declines arrive instantly.',
  },
  mpNotifyUrlSummary: {
    es: 'Conectar pegando la URL de avisos',
    en: 'Connect by pasting the notifications URL',
  },
  mpNotifyUrlCopy: { es: 'Copiar URL', en: 'Copy URL' },
  mpNotifyUrlCopied: { es: 'URL copiada', en: 'URL copied' },
  mpRenewFailed: {
    es: 'No pudimos renovar la conexión con Mercado Pago. Vuelve a conectarla o la recuperación de pagos va a dejar de funcionar.',
    en: "We couldn't renew the Mercado Pago connection. Reconnect it or payment recovery will stop working.",
  },
  mpExpiringSoon: {
    es: 'Tu acceso a Mercado Pago vence el {date}. Vuelve a conectarlo para que la recuperación siga andando.',
    en: 'Your Mercado Pago access expires on {date}. Reconnect it to keep recovery running.',
  },
  mpReconnect: { es: 'Volver a conectar', en: 'Reconnect' },
  mpUpgradeHint: {
    es: 'Autoriza la aplicación y se renueva sola, sin pegar ninguna URL.',
    en: 'Authorize the app and it renews itself, with no URL to paste.',
  },
  mpUpgradeCta: { es: 'Conectar con un clic', en: 'Connect with one click' },
  connectResultOk: { es: 'Cuenta conectada', en: 'Account connected' },
  connectResultError: { es: 'No se pudo conectar', en: "Couldn't connect" },
  connectResultErrorDetail: {
    es: 'No se pudo completar la conexión. Inténtalo de nuevo.',
    en: "We couldn't complete the connection. Try again.",
  },
  mailboxAddressUnavailable: {
    es: 'No se pudo identificar la dirección del buzón. Vuelve a conectar la cuenta.',
    en: "We couldn't identify the mailbox address. Reconnect the account.",
  },
  zohoMailboxRequired: {
    es: 'Esta cuenta no tiene un buzón activo de Zoho Mail. Conecta una cuenta con Zoho Mail configurado.',
    en: 'This account does not have an active Zoho Mail mailbox. Connect an account with Zoho Mail configured.',
  },
  zohoInboxRequired: {
    es: 'Esta cuenta de Zoho Mail no tiene una bandeja de entrada disponible.',
    en: 'This Zoho Mail account does not have an available inbox.',
  },
  zohoSchemaUnavailable: {
    es: 'Riverz necesita actualizar su base de datos para conectar Zoho. El problema no está en tu correo.',
    en: 'Riverz needs a database update to connect Zoho. The issue is not with your email account.',
  },
  zohoAuthorizationDenied: {
    es: 'Zoho no autorizó el acceso al buzón. Marca la casilla de permiso y acepta.',
    en: 'Zoho did not authorize mailbox access. Select the permission checkbox and accept.',
  },
  zohoAuthorizationExpired: {
    es: 'La autorización de Zoho venció antes de completarse. Vuelve a conectarla y acepta de inmediato.',
    en: 'Zoho authorization expired before it was completed. Reconnect and accept right away.',
  },
  zohoTokenExchangeFailed: {
    es: 'Zoho autorizó la cuenta, pero no entregó un acceso usable. Vuelve a conectar la misma cuenta de Zoho Mail.',
    en: 'Zoho authorized the account but did not provide usable access. Reconnect the same Zoho Mail account.',
  },
  connectResultCancelled: {
    es: 'Conexión cancelada',
    en: 'Connection cancelled',
  },
  connectResultRetry: {
    es: 'La autorización venció. Vuelve a darle a Conectar.',
    en: 'The authorization expired. Hit Connect again.',
  },
  mpDisconnect: {
    es: 'Desconectar Mercado Pago',
    en: 'Disconnect Mercado Pago',
  },
  replaceApiKeyPlaceholder: {
    es: 'Reemplazar API key…',
    en: 'Replace API key…',
  },
  update: { es: 'Actualizar', en: 'Update' },
  disconnectKlaviyo: { es: 'Desconectar Klaviyo', en: 'Disconnect Klaviyo' },
  klaviyoApiKeyPlaceholder: {
    es: 'Klaviyo Private API key (pk_…)',
    en: 'Klaviyo Private API key (pk_…)',
  },

  // Meta business login
  metaConnectError: { es: 'No se pudo conectar', en: "Couldn't connect" },
  metaConnectedAccounts: {
    es: 'Conectado: {n} cuenta(s)',
    en: 'Connected: {n} account(s)',
  },
  metaNoAccounts: {
    es: 'No se encontraron cuentas para conectar',
    en: 'No accounts found to connect',
  },
  metaPickerWorkspaceScope: {
    es: 'Elige los activos de esta cuenta de Riverz.',
    en: 'Choose the assets for this Riverz account.',
  },
  noFacebookPagesFound: {
    es: 'No se encontraron páginas de Facebook',
    en: 'No Facebook pages found',
  },
  noInstagramAccountsFound: {
    es: 'No se encontraron cuentas de Instagram',
    en: 'No Instagram accounts found',
  },
  metaConnectionCancelled: {
    es: 'Conexión cancelada',
    en: 'Connection cancelled',
  },
  metaAccessNeedsRefresh: {
    es: 'Renueva el permiso de este activo. Solo se conectará esta marca.',
    en: 'Renew permission for this asset. Only this brand will be connected.',
  },
  whatsappSinRegistrar: {
    es: 'El número no quedó registrado y no puede enviar. Ingresa su PIN de verificación en dos pasos.',
    en: "The number isn't registered and can't send. Enter its two-step verification PIN.",
  },
  whatsappPin: { es: 'PIN de 6 dígitos', en: '6-digit PIN' },
  whatsappRegistrar: { es: 'Registrar', en: 'Register' },
  whatsappRegistrado: { es: 'Número registrado', en: 'Number registered' },
  whatsappEchoesMissing: {
    es: 'Las respuestas que envías desde la app de WhatsApp Business no están llegando a Riverz. Vuelve a conectar el número.',
    en: 'Replies you send from the WhatsApp Business app aren’t reaching Riverz. Reconnect the number.',
  },
  metaAssetAccessNeedsRenewal: {
    es: 'Meta ya no puede acceder a {account}. Conserva los activos de este perfil en Meta; aquí solo se conecta esta marca.',
    en: 'Meta can no longer access {account}. Keep this profile’s assets in Meta; only this brand connects here.',
  },
  metaReconnectAccountUnavailable: {
    es: 'Meta no devolvió esta cuenta. Revisa sus permisos en Meta Business Suite.',
    en: 'Meta did not return this account. Check its permissions in Meta Business Suite.',
  },
  addAnotherAccount: { es: 'Añadir otra cuenta', en: 'Add another account' },
  connectFacebookPage: {
    es: 'Conectar Facebook',
    en: 'Connect Facebook',
  },
  reauthorizeFacebook: {
    es: 'Renovar permiso de Facebook',
    en: 'Renew Facebook permission',
  },
  addAnotherFacebookPage: {
    es: 'Añadir otra página',
    en: 'Add another page',
  },
  connectMeta: { es: 'Conectar Meta', en: 'Connect Meta' },
  reauthorizeMeta: {
    es: 'Renovar permiso de Meta',
    en: 'Renew Meta permission',
  },
  addAnotherMetaAccount: {
    es: 'Añadir otra cuenta de Meta',
    en: 'Add another Meta account',
  },
  connectInstagramAccount: {
    es: 'Conectar Instagram',
    en: 'Connect Instagram',
  },
  reauthorizeInstagram: {
    es: 'Renovar permiso de Instagram',
    en: 'Renew Instagram permission',
  },
  addAnotherInstagramAccount: {
    es: 'Añadir otra cuenta',
    en: 'Add another account',
  },
  chooseAccountsToConnect: {
    es: 'Elige las cuentas a conectar',
    en: 'Choose the accounts to connect',
  },
  chooseFacebookPagesToConnect: {
    es: 'Elige las páginas de Facebook',
    en: 'Choose Facebook pages',
  },
  chooseMetaAccountsToConnect: {
    es: 'Elige las cuentas de Facebook e Instagram',
    en: 'Choose Facebook and Instagram accounts',
  },
  metaPageId: {
    es: 'ID: {id}',
    en: 'ID: {id}',
  },
  metaInstagramAccountId: {
    es: 'ID: {id}',
    en: 'ID: {id}',
  },
  chooseInstagramAccountsToConnect: {
    es: 'Elige las cuentas de Instagram',
    en: 'Choose Instagram accounts',
  },
  chooseFacebookAdAccounts: {
    es: 'Cuentas publicitarias (opcional)',
    en: 'Ad accounts (optional)',
  },
  noFacebookAdAccountsFound: {
    es: 'No se encontraron cuentas publicitarias.',
    en: 'No ad accounts found.',
  },
  metaAdAccountId: {
    es: 'ID: {id}',
    en: 'ID: {id}',
  },
  connectSelected: {
    es: 'Conectar seleccionadas ({n})',
    en: 'Connect selected ({n})',
  },

  // Profile form
  profileTitle: { es: 'Perfil', en: 'Profile' },
  passwordTitle: { es: 'Contraseña', en: 'Password' },
  currentPasswordLabel: {
    es: 'Contraseña actual',
    en: 'Current password',
  },
  newPasswordLabel: { es: 'Nueva contraseña', en: 'New password' },
  confirmNewPasswordLabel: {
    es: 'Confirmar nueva contraseña',
    en: 'Confirm new password',
  },
  changePassword: { es: 'Cambiar contraseña', en: 'Change password' },
  passwordMin8: {
    es: 'La contraseña debe tener al menos 8 caracteres.',
    en: 'Password must be at least 8 characters.',
  },
  passwordsDontMatch: {
    es: 'Las contraseñas no coinciden.',
    en: 'Passwords do not match.',
  },
  currentPasswordIncorrect: {
    es: 'La contraseña actual no es correcta.',
    en: 'The current password is incorrect.',
  },
  passwordChanged: {
    es: 'Contraseña actualizada.',
    en: 'Password updated.',
  },
  passwordChangeFailed: {
    es: 'No se pudo actualizar la contraseña.',
    en: 'Could not update the password.',
  },
  avatarInvalidType: {
    es: 'Usa PNG, JPG, WebP o GIF.',
    en: 'Use PNG, JPG, WebP or GIF.',
  },
  avatarTooLarge: { es: 'Máximo 2 MB.', en: 'Maximum 2 MB.' },
  nameMissing: { es: 'Falta el nombre.', en: 'Name is missing.' },
  emailInvalid: { es: 'Correo inválido.', en: 'Invalid email.' },
  uploadFailed: {
    es: 'Falló la subida: {message}',
    en: 'Upload failed: {message}',
  },
  saveFailed: {
    es: 'No se pudo guardar: {message}',
    en: "Couldn't save: {message}",
  },
  emailChangeFailed: {
    es: 'No se pudo cambiar el correo: {message}',
    en: "Couldn't change the email: {message}",
  },
  genericError: { es: 'Error', en: 'Error' },
  savedEmailConfirm: {
    es: 'Guardado: confirma el cambio de correo desde tu bandeja',
    en: 'Saved: confirm the email change from your inbox',
  },
  avatarAlt: { es: 'Avatar', en: 'Avatar' },
  changePhoto: { es: 'Cambiar foto', en: 'Change photo' },
  uploadPhoto: { es: 'Subir foto', en: 'Upload photo' },
  displayName: { es: 'Nombre para mostrar', en: 'Display name' },
  emailLabel: { es: 'Correo', en: 'Email' },
  tabMcp: { es: 'Asistentes de IA', en: 'AI assistants' },
  mcpTitle: {
    es: 'Conecta tu asistente de IA',
    en: 'Connect your AI assistant',
  },
  mcpManual: { es: 'Configuración manual', en: 'Manual setup' },
  mcpDesc: {
    es: 'Consulta y gestiona tu negocio desde el asistente que ya usas.',
    en: 'View and manage your business from the assistant you already use.',
  },
  mcpStep1: { es: 'Crea una llave', en: 'Create a key' },
  mcpStep2: {
    es: 'Pégala en tu asistente',
    en: 'Paste it into your assistant',
  },
  mcpDocs: { es: 'Ver documentación', en: 'View documentation' },
  mcpCreate: { es: 'Crear llave', en: 'Create key' },
  mcpNamePlaceholder: {
    es: 'Para qué es (mi laptop, n8n…)',
    en: 'What it is for (my laptop, n8n…)',
  },
  mcpCopyNow: {
    es: 'Cópiala ahora: es la única vez que se muestra.',
    en: 'Copy it now: this is the only time it is shown.',
  },
  mcpHideToken: { es: 'Ya la guardé', en: 'I saved it' },
  mcpLastUsed: { es: 'usada {when}', en: 'used {when}' },
  mcpNeverUsed: { es: 'sin usar', en: 'never used' },
  mcpRevoke: { es: 'Revocar', en: 'Revoke' },
  mcpRevoked: { es: 'Llave revocada', en: 'Key revoked' },
  mcpRevokeFailed: { es: 'No se pudo revocar', en: "Couldn't revoke" },
  mcpCreateFailed: { es: 'No se pudo crear', en: "Couldn't create" },
  mcpNoKeys: { es: 'Todavía no hay ninguna llave.', en: 'No keys yet.' },
  mcpTooMany: {
    es: 'Ya hay diez llaves activas. Revoca alguna antes de crear otra.',
    en: 'There are already ten active keys. Revoke one before creating another.',
  },
  mcpScopeRead: { es: 'Sólo lectura', en: 'Read only' },
  mcpScopeFull: { es: 'Lectura y escritura', en: 'Read and write' },
  mcpScopeReadHint: {
    es: 'Consulta tu operación y no cambia nada.',
    en: 'Queries your operation and changes nothing.',
  },
  mcpScopeFullHint: {
    es: 'Además puede activar automatizaciones y escribirle a un cliente. Lo irreversible sigue pidiendo confirmación.',
    en: 'Can also turn on automations and message a customer. Irreversible actions still ask for confirmation.',
  },
  mcpActivity: { es: 'Actividad', en: 'Activity' },
  mcpKeyPlaceholder: { es: 'TU_LLAVE', en: 'YOUR_KEY' },
  mcpHowTitle: { es: 'Configuración para pegar', en: 'Configuration to paste' },
  mcpOauthNote: {
    es: 'Los clientes que soportan OAuth no necesitan llave: basta con darles la dirección del servidor.',
    en: 'Clients that support OAuth need no key: just give them the server address.',
  },
  mcpCopied: { es: 'Copiado', en: 'Copied' },
  phoneLabel: { es: 'WhatsApp', en: 'WhatsApp' },
  phoneHint: {
    es: 'Elige qué avisos recibe cada número.',
    en: 'Choose which alerts each number receives.',
  },
  alertScopeLabel: { es: 'Tipo de aviso', en: 'Alert type' },
  alertScopeBoth: { es: 'Ambas', en: 'Both' },
  alertScopeEscalations: { es: 'Escalaciones', en: 'Escalations' },
  alertScopeNotifications: { es: 'Notificaciones', en: 'Notifications' },
  phoneAdd: { es: 'Agregar otro número', en: 'Add another number' },
  phoneRemove: { es: 'Quitar', en: 'Remove' },
  phoneInvalid: {
    es: 'Ese número no parece válido. Incluye el código de país.',
    en: "That number doesn't look valid. Include the country code.",
  },
  emailChangePendingNotice: {
    es: 'Revisa la bandeja de {oldEmail} y {newEmail}, ambos deben confirmar antes de que el cambio tenga efecto.',
    en: 'Check the inbox of {oldEmail} and {newEmail}, both must confirm before the change takes effect.',
  },
  accountData: { es: 'Datos de la cuenta', en: 'Account data' },
  roleLabel: { es: 'Rol', en: 'Role' },
  joinedOn: { es: 'Registrado el', en: 'Joined on' },
  userId: { es: 'ID de usuario', en: 'User ID' },

  // Shopify card
  shopifyConnected: { es: 'Shopify conectado', en: 'Shopify connected' },
  shopifyConnectError: {
    es: 'No se pudo conectar Shopify ({reason})',
    en: "Couldn't connect Shopify ({reason})",
  },
  shopifyMissingDomain: {
    es: 'Falta el dominio de la tienda.',
    en: 'Store domain is missing.',
  },
  shopifyDisconnectConfirm: {
    es: '¿Desconectar Shopify?',
    en: 'Disconnect Shopify?',
  },
  shopifyDisconnected: {
    es: 'Shopify desconectado',
    en: 'Shopify disconnected',
  },
  shopifyDescription: {
    es: 'Disparadores de carrito abandonado y pedidos hacia WhatsApp.',
    en: 'Abandoned cart and order triggers to WhatsApp.',
  },
  shopifyMissingCredentials: {
    es: 'Faltan credenciales SHOPIFY_API_KEY / SHOPIFY_API_SECRET en el servidor.',
    en: 'Missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET credentials on the server.',
  },
  disconnect: { es: 'Desconectar', en: 'Disconnect' },
  shopifyDomainPlaceholder: {
    es: 'tu-tienda.myshopify.com',
    en: 'your-store.myshopify.com',
  },
  addAnotherStore: { es: 'Añadir otra tienda', en: 'Add another store' },
  missingCredentials: { es: 'Faltan credenciales', en: 'Missing credentials' },
  shopifyUseClientCredentialsLink: {
    es: 'o usar credenciales de Shopify',
    en: 'or use Shopify credentials',
  },
  shopifyClientIdPlaceholder: {
    es: 'Client ID',
    en: 'Client ID',
  },
  shopifyClientSecretPlaceholder: {
    es: 'Client secret',
    en: 'Client secret',
  },
  shopifyClientCredentialsMissingFields: {
    es: 'Completa el dominio, el Client ID y el Client secret.',
    en: 'Fill in the domain, Client ID and Client secret.',
  },
  shopifyClientCredentialsGuide: {
    es: 'Crea la app en el Dev Dashboard con estos datos, sin «Incrustar app», y pega su Client ID y Client secret. Si todavía no está instalada, la tienda se conecta sola al instalarla.',
    en: 'Create the app in the Dev Dashboard with these values, without “Embed app”, and paste its Client ID and Client secret. If it isn’t installed yet, the store connects by itself once it is.',
  },
  shopifyAppUrlLabel: { es: 'URL de la app', en: 'App URL' },
  shopifyRedirectUrlLabel: { es: 'Redirección', en: 'Redirect URL' },
  shopifyScopesLabel: { es: 'Alcances', en: 'Scopes' },
  shopifyValueCopied: { es: 'Copiado', en: 'Copied' },
  shopifyAwaitingInstallToast: {
    es: 'Credenciales guardadas. La tienda se conecta sola cuando se instale la app.',
    en: 'Credentials saved. The store connects by itself once the app is installed.',
  },
  shopifyAwaitingInstall: {
    es: 'Esperando que se instale la app en {shop}',
    en: 'Waiting for the app to be installed on {shop}',
  },
  shopifyInstalledTitle: {
    es: 'Tu tienda quedó conectada a Riverz',
    en: 'Your store is connected to Riverz',
  },
  shopifyInstalledBody: {
    es: 'Ya puedes cerrar esta pestaña.',
    en: 'You can close this tab.',
  },
  shopifyInstallErrorTitle: {
    es: 'No pudimos conectar tu tienda',
    en: "We couldn't connect your store",
  },
  shopifyInstallErrorBody: {
    es: 'Avísale a quien te envió el enlace. Cuando te confirme, abre la app desde tu admin de Shopify.',
    en: 'Let whoever sent you the link know. Once they confirm, open the app from your Shopify admin.',
  },
  shopifyConnectedViaClientCredentials: {
    es: 'vía credenciales de Shopify',
    en: 'via Shopify credentials',
  },
  shopifyStoreClaimed: {
    es: 'Tienda {shop} conectada',
    en: 'Store {shop} connected',
  },
  storeClaimed: {
    es: 'Tienda {shop} conectada',
    en: 'Store {shop} connected',
  },

  // Tiendanube card
  tiendanubeDescription: {
    es: 'Carritos abandonados y pedidos hacia WhatsApp.',
    en: 'Abandoned carts and orders to WhatsApp.',
  },
  tiendanubeConnected: {
    es: 'Tiendanube conectada',
    en: 'Tiendanube connected',
  },
  tiendanubeDisconnected: {
    es: 'Tiendanube desconectada',
    en: 'Tiendanube disconnected',
  },
  tiendanubeDisconnectConfirm: {
    es: '¿Desconectar Tiendanube?',
    en: 'Disconnect Tiendanube?',
  },
  tiendanubeConnectError: {
    es: 'No se pudo conectar Tiendanube ({reason})',
    en: "Couldn't connect Tiendanube ({reason})",
  },

  // WooCommerce card
  woocommerceDescription: {
    es: 'Carritos abandonados y pedidos hacia WhatsApp.',
    en: 'Abandoned carts and orders to WhatsApp.',
  },
  woocommerceConnected: {
    es: 'WooCommerce conectado',
    en: 'WooCommerce connected',
  },
  woocommerceDisconnected: {
    es: 'WooCommerce desconectado',
    en: 'WooCommerce disconnected',
  },
  woocommerceDisconnectConfirm: {
    es: '¿Desconectar WooCommerce?',
    en: 'Disconnect WooCommerce?',
  },
  woocommerceConnectError: {
    es: 'No se pudo conectar WooCommerce ({reason})',
    en: "Couldn't connect WooCommerce ({reason})",
  },
  woocommerceSitePlaceholder: {
    es: 'mitienda.com',
    en: 'mystore.com',
  },
  woocommerceUseKeysLink: {
    es: 'o pegar claves de API',
    en: 'or paste API keys',
  },
  woocommerceKeysGuide: {
    es: 'En WooCommerce → Ajustes → Avanzado → API REST: crea una clave con permiso de lectura/escritura y copia la clave y el secreto.',
    en: 'In WooCommerce → Settings → Advanced → REST API: create a key with read/write permission and copy the key and secret.',
  },
  woocommerceKeyPlaceholder: {
    es: 'Clave de cliente (ck_…)',
    en: 'Consumer key (ck_…)',
  },
  woocommerceSecretPlaceholder: {
    es: 'Secreto de cliente (cs_…)',
    en: 'Consumer secret (cs_…)',
  },
  woocommerceKeysMissingFields: {
    es: 'Completa la dirección, la clave y el secreto.',
    en: 'Fill in the address, key and secret.',
  },
  // Qué hacer después de conectar WooCommerce
  wooDialogAfterTitle: {
    es: 'Tienda conectada',
    en: 'Store connected',
  },
  wooDialogAfterIntro: {
    es: 'Falta un paso para recuperar carritos abandonados: WooCommerce no los registra por su cuenta.',
    en: "One step left to recover abandoned carts: WooCommerce doesn't track them on its own.",
  },
  wooDialogInstall1: {
    es: 'Descarga el plugin (viene con tus datos ya cargados).',
    en: 'Download the plugin (it comes preconfigured).',
  },
  wooDialogInstall2: {
    es: 'En tu WordPress: Plugins → Añadir nuevo → Subir plugin.',
    en: 'In your WordPress: Plugins → Add new → Upload plugin.',
  },
  wooDialogInstall3: {
    es: 'Actívalo. Listo, no hay nada más que configurar.',
    en: 'Activate it. Done, nothing else to configure.',
  },
  wooDialogLater: {
    es: 'Más tarde',
    en: 'Later',
  },
  woocommerceCartPlugin: {
    es: 'Recuperar carritos',
    en: 'Recover carts',
  },
  woocommerceCartPluginHint: {
    es: 'Recupera también los carritos que se abandonan antes de enviar el pedido.',
    en: 'Also recover carts abandoned before the order is placed.',
  },
  woocommerceDownloadPlugin: {
    es: 'Descargar plugin',
    en: 'Download plugin',
  },
  woocommercePluginReady: {
    es: 'El plugin viene con tus datos ya cargados: instálalo y actívalo.',
    en: 'The plugin comes preconfigured: just install and activate it.',
  },
  woocommercePluginError: {
    es: 'No se pudo preparar el plugin.',
    en: "Couldn't prepare the plugin.",
  },

  // Común a las tarjetas de tienda
  storeSyncCatalog: { es: 'Sincronizar catálogo', en: 'Sync catalog' },
  storeCatalogSynced: {
    es: '{count} productos sincronizados',
    en: '{count} products synced',
  },
  storeSyncError: {
    es: 'No se pudo sincronizar el catálogo.',
    en: "Couldn't sync the catalog.",
  },

  // Shopify embedded admin surface (App Bridge page inside Shopify admin)
  shopifyEmbeddedConnected: {
    es: 'Tienda conectada a Riverz',
    en: 'Store connected to Riverz',
  },
  shopifyEmbeddedChatActive: {
    es: 'Chat web activo',
    en: 'Web chat active',
  },
  shopifyEmbeddedChatPending: {
    es: 'Chat web pendiente',
    en: 'Web chat pending',
  },
  shopifyEmbeddedChatUnavailable: {
    es: 'Chat web requiere acción',
    en: 'Web chat requires action',
  },
  shopifyEmbeddedEnableChat: {
    es: 'Activar chat',
    en: 'Enable chat',
  },
  shopifyEmbeddedPending: {
    es: 'Falta vincular tu cuenta Riverz',
    en: 'Riverz account not linked yet',
  },
  shopifyEmbeddedOpen: { es: 'Abrir Riverz', en: 'Open Riverz' },
  shopifyEmbeddedFinish: {
    es: 'Completar instalación',
    en: 'Complete installation',
  },
  shopifyEmbeddedError: {
    es: 'No se pudo verificar la sesión de Shopify.',
    en: "Couldn't verify the Shopify session.",
  },

  // WhatsApp embedded signup
  whatsappAccountNotReceived: {
    es: 'No se recibió la cuenta de WhatsApp.',
    en: "WhatsApp account wasn't received.",
  },
  whatsappConnectError: {
    es: 'No se pudo conectar WhatsApp',
    en: "Couldn't connect WhatsApp",
  },
  whatsappConnectedCoexistence: {
    es: 'WhatsApp conectado en coexistencia: {label}',
    en: 'WhatsApp connected in coexistence: {label}',
  },
  whatsappConnectedLabel: {
    es: 'WhatsApp conectado: {label}',
    en: 'WhatsApp connected: {label}',
  },
  whatsappConnectedInReview: {
    es: 'WhatsApp conectado. Ya puedes enviar y recibir; Meta está revisando tu negocio en segundo plano (hasta 24 h).',
    en: 'WhatsApp connected. You can already send and receive; Meta is reviewing your business in the background (up to 24 h).',
  },
  whatsappConnectedCannotSend: {
    es: 'WhatsApp conectado: ya recibes mensajes, pero Meta aún no habilita el envío. Revisa el estado de la cuenta en WhatsApp Manager.',
    en: "WhatsApp connected: you can already receive messages, but Meta hasn't enabled sending yet. Check the account status in WhatsApp Manager.",
  },
  whatsappOnboardingCancelled: {
    es: 'Onboarding cancelado',
    en: 'Onboarding cancelled',
  },
  connectWhatsappOfficial: {
    es: 'Conectar WhatsApp (oficial)',
    en: 'Connect WhatsApp (official)',
  },
  connectWhatsapp: {
    es: 'Conectar WhatsApp',
    en: 'Connect WhatsApp',
  },
  whatsappCoexistenceHint: {
    es: 'Número nuevo o sigue usando tu WhatsApp Business del teléfono con el mismo número.',
    en: "A new number, or keep using your phone's WhatsApp Business with the same number.",
  },

  // Workspace panel
  workspaceDeleteError: {
    es: 'No se pudo eliminar el espacio de trabajo',
    en: "Couldn't delete the workspace",
  },
  workspaceDeleted: {
    es: 'Espacio de trabajo eliminado',
    en: 'Workspace deleted',
  },
  workspaceRenamed: {
    es: 'Espacio de trabajo renombrado',
    en: 'Workspace renamed',
  },
  timezoneUpdated: { es: 'Zona horaria actualizada', en: 'Timezone updated' },
  inviteError: {
    es: 'No se pudo enviar la invitación',
    en: "Couldn't send the invitation",
  },
  inviteSent: {
    es: 'Invitación enviada a {email}',
    en: 'Invitation sent to {email}',
  },
  inviteLinkCopied: {
    es: 'Invitación creada. Enlace copiado: envíaselo tú.',
    en: 'Invitation created. Link copied: send it yourself.',
  },
  memberRemoved: { es: 'Miembro eliminado', en: 'Member removed' },
  noWorkspace: {
    es: 'Sin espacio de trabajo. Vuelve a iniciar sesión.',
    en: 'No workspace. Sign in again.',
  },
  workspace: { es: 'Espacio de trabajo', en: 'Workspace' },
  nameLabel: { es: 'Nombre', en: 'Name' },
  timezoneLabel: { es: 'Zona horaria', en: 'Timezone' },
  timezoneHint: {
    es: 'Rige el día de todas las métricas y las horas que se muestran en la bandeja, para todo el equipo.',
    en: 'Governs the day for all metrics and the hours shown in the inbox, for the whole team.',
  },
  teamMembers: { es: 'Miembros del equipo', en: 'Team members' },
  memberPending: { es: 'Pendiente', en: 'Pending' },
  memberYou: { es: '(tú)', en: '(you)' },
  roleAdmin: { es: 'Administrador', en: 'Admin' },
  roleAgent: { es: 'Usuario', en: 'User' },
  removeMember: { es: 'Eliminar miembro', en: 'Remove member' },

  // Per-member menu access (RBAC)
  menuAccess: { es: 'Acceso al menú', en: 'Menu access' },
  menuAccessFull: { es: 'Acceso completo', en: 'Full access' },

  menuAccessHint: {
    es: 'Elige a qué secciones del menú puede entrar.',
    en: 'Choose which menu sections they can open.',
  },
  accessUpdated: { es: 'Acceso actualizado', en: 'Access updated' },
  invite: { es: 'Invitar', en: 'Invite' },
  invitePlaceholder: {
    es: 'compañero@email.com',
    en: 'teammate@email.com',
  },
  send: { es: 'Enviar', en: 'Send' },
  inviteAccessTitle: {
    es: 'Acceso de {email}',
    en: 'Access for {email}',
  },
  pendingInvites: {
    es: 'Invitaciones pendientes',
    en: 'Pending invitations',
  },
  inviteRoleExpires: {
    es: 'Rol: {role} · expira el {date}',
    en: 'Role: {role} · expires on {date}',
  },
  revokeInvite: { es: 'Revocar invitación', en: 'Revoke invitation' },
  deleteWorkspacePermanently: {
    es: 'Eliminar workspace permanentemente',
    en: 'Delete workspace permanently',
  },
  deleteWorkspaceWarning: {
    es: 'El espacio se ocultará de inmediato para todo el equipo. La depuración real de datos personales corre como un proceso aparte.',
    en: 'The workspace will be hidden immediately for the whole team. Actual deletion of personal data runs as a separate process.',
  },
  deleteWorkspaceConfirmPlaceholder: {
    es: 'Escribe "{name}" para confirmar',
    en: 'Type "{name}" to confirm',
  },
  deleteWorkspace: { es: 'Eliminar workspace', en: 'Delete workspace' },

  // Channels panel — card descriptions
  whatsappCardDescription: {
    es: 'Cloud API, WhatsApp Business o coexistencia.',
    en: 'Cloud API, WhatsApp Business or coexistence.',
  },
  facebookCardDescription: {
    es: 'Messenger y comentarios de Facebook.',
    en: 'Messenger and Facebook comments.',
  },
  metaCardDescription: {
    es: 'Facebook e Instagram de tu marca.',
    en: 'Your brand’s Facebook and Instagram.',
  },
  instagramCardDescription: {
    es: 'Mensajes y comentarios de Instagram.',
    en: 'Instagram messages and comments.',
  },
  gmailCardDescription: {
    es: 'Cuentas @gmail o Google Workspace.',
    en: '@gmail or Google Workspace accounts.',
  },
  outlookCardDescription: {
    es: 'Bandeja para Outlook, Hotmail y Microsoft 365.',
    en: 'Inbox for Outlook, Hotmail and Microsoft 365.',
  },
  zohoCardDescription: {
    es: 'Bandeja de Zoho Mail para responder automáticamente.',
    en: 'Zoho Mail inbox for automated replies.',
  },
  mercadolibreCardDescription: {
    es: 'Preguntas de tus publicaciones y mensajes post-venta.',
    en: 'Questions on your listings and post-sale messages.',
  },
  mercadolibreRefreshTokenMissing: {
    es: 'Mercado Libre no entregó acceso renovable. Revisa que la aplicación tenga Acceso offline y vuelve a conectar.',
    en: 'Mercado Libre did not issue renewable access. Check that the app has Offline access enabled, then reconnect.',
  },
  tiktokCardDescription: {
    es: 'Comentarios de tus videos de TikTok.',
    en: 'Comments on your TikTok videos.',
  },
  tiktokBusinessNote: {
    es: 'Requiere cuenta Business (cámbiala gratis en Ajustes de TikTok).',
    en: 'Requires a Business account (switch for free in TikTok Settings).',
  },

  // Channels panel — clipboard + toasts
  copiedToClipboard: { es: '{label} copiado', en: '{label} copied' },
  couldNotCopy: { es: 'No se pudo copiar', en: "Couldn't copy" },
  disconnectChannelConfirm: {
    es: '¿Desconectar este canal?',
    en: 'Disconnect this channel?',
  },
  channelDisconnected: { es: 'Canal desconectado', en: 'Channel disconnected' },

  // Channels panel — empty / read-only states
  workspaceNotFound: {
    es: 'No se encontró tu espacio de trabajo.',
    en: "Your workspace wasn't found.",
  },
  readOnly: { es: 'Solo lectura.', en: 'Read only.' },

  // Channels panel — OAuth providers banner
  oauthAppsMissing: {
    es: 'Faltan apps OAuth por registrar',
    en: 'OAuth apps still need to be registered',
  },
  redirectUrisToPaste: {
    es: 'Redirect URIs a pegar en cada consola:',
    en: 'Redirect URIs to paste in each console:',
  },
  copy: { es: 'Copiar', en: 'Copy' },

  // Channels panel — header
  channels: { es: 'Canales', en: 'Channels' },
  channelActive: { es: 'canal activo', en: 'active channel' },
  channelsActive: { es: 'canales activos', en: 'active channels' },

  // Channels panel — connection rows
  noLabel: { es: 'Sin etiqueta', en: 'No label' },
  disconnectAction: { es: 'Desconectar', en: 'Disconnect' },
  deleteAction: { es: 'Eliminar', en: 'Delete' },
  configurePaymentMethod: {
    es: 'Configurar medio de pago',
    en: 'Set up payment method',
  },
  whatsappManagerPaymentTooltip: {
    es: 'Meta → Facturación y pagos → Métodos de pago',
    en: 'Meta → Billing & payments → Payment methods',
  },

  // Channels panel — estado de entrega de WhatsApp
  healthAvailable: { es: 'Envío disponible', en: 'Sending available' },
  healthLimited: { es: 'Envío limitado', en: 'Sending limited' },
  healthBlocked: { es: 'Envío bloqueado', en: 'Sending blocked' },
  healthTier: { es: 'Cupo: {tier}/24 h', en: 'Limit: {tier}/24 h' },
  healthQuality: { es: 'Calidad', en: 'Quality' },
  healthVerifyNote: {
    es: 'Verificar el negocio sube el cupo. No destraba la entrega a números fríos.',
    en: "Verifying the business raises your limit. It doesn't unblock delivery to cold numbers.",
  },
  verifyBusiness: { es: 'Verificar negocio', en: 'Verify business' },

  // Channels panel — CTAs
  oneWhatsappPerAccount: {
    es: 'Un WhatsApp por cuenta. Desconéctalo para cambiar de número.',
    en: 'One WhatsApp per account. Disconnect it to switch numbers.',
  },
  orConnectPastingToken: {
    es: 'o conectar pegando un token manualmente',
    en: 'or connect by pasting a token manually',
  },
  configureProvider: {
    es: 'Configura el proveedor',
    en: 'Set up the provider',
  },
  comingSoon: { es: 'Próximamente', en: 'Coming soon' },
  mlCountryLabel: { es: 'País', en: 'Country' },
  mlCountryPlaceholder: { es: 'Elige tu país', en: 'Choose your country' },
  mlChooseCountryFirst: {
    es: 'Elige tu país antes de conectar.',
    en: 'Choose your country before connecting.',
  },
  mlOpening: { es: 'Abriendo Mercado Libre…', en: 'Opening Mercado Libre…' },
  mlCancelAdd: { es: 'Cancelar', en: 'Cancel' },
  connect: { es: 'Conectar', en: 'Connect' },
  configureGoogleFirst: {
    es: 'Configura Google Cloud OAuth Client primero (ver banner amarillo)',
    en: 'Set up the Google Cloud OAuth Client first (see the yellow banner)',
  },
  configureMicrosoftFirst: {
    es: 'Configura Microsoft Azure App primero (ver banner amarillo)',
    en: 'Set up the Microsoft Azure App first (see the yellow banner)',
  },
  configureMetaFirst: {
    es: 'Configura la Meta App primero (ver banner amarillo)',
    en: 'Set up the Meta App first (see the yellow banner)',
  },
  disconnectAllAccountsConfirm: {
    es: '¿Desconectar las {n} cuentas de {label}?',
    en: 'Disconnect the {n} {label} accounts?',
  },
  disconnectAll: { es: 'Desconectar todas', en: 'Disconnect all' },
  disconnectAllN: {
    es: 'Desconectar las {n} cuentas',
    en: 'Disconnect all {n} accounts',
  },

  // Channels panel — manual token modal
  manualLabelWhatsapp: { es: 'WhatsApp', en: 'WhatsApp' },
  manualLabelMessenger: { es: 'Facebook Messenger', en: 'Facebook Messenger' },
  manualLabelInstagram: { es: 'Instagram DMs', en: 'Instagram DMs' },
  manualLabelFbComment: { es: 'Comentarios FB', en: 'FB comments' },
  manualLabelIgComment: { es: 'Comentarios IG', en: 'IG comments' },
  manualTipWhatsapp: {
    es: 'Pega un System User Token (whatsapp_business_messaging + whatsapp_business_management), el phone_number_id y el waba_id. El número debe estar registrado en Cloud API y no en uso en la app de WhatsApp Business del celular.',
    en: 'Paste a System User Token (whatsapp_business_messaging + whatsapp_business_management), the phone_number_id and the waba_id. The number must be registered in Cloud API and not in use in the WhatsApp Business phone app.',
  },
  manualTipMessenger: {
    es: 'Pega un Page Access Token de la página (Business Settings → System Users → Generar identificador con permiso pages_messaging + pages_show_list).',
    en: "Paste the page's Page Access Token (Business Settings → System Users → Generate token with the pages_messaging + pages_show_list permissions).",
  },
  manualTipInstagram: {
    es: 'Pega el Page Access Token de la página que tiene la cuenta IG Profesional vinculada. Necesita permisos instagram_basic + instagram_manage_messages.',
    en: 'Paste the Page Access Token of the page linked to the IG Professional account. It needs the instagram_basic + instagram_manage_messages permissions.',
  },
  manualTipFbComment: {
    es: 'Pega el Page Access Token con permisos pages_read_engagement + pages_manage_engagement.',
    en: 'Paste the Page Access Token with the pages_read_engagement + pages_manage_engagement permissions.',
  },
  manualTipIgComment: {
    es: 'Pega el Page Access Token de la página que gestiona la cuenta IG con instagram_manage_comments.',
    en: 'Paste the Page Access Token of the page managing the IG account with instagram_manage_comments.',
  },
  pasteAToken: { es: 'Pega un token', en: 'Paste a token' },
  whatsappNeedsIds: {
    es: 'WhatsApp necesita phone_number_id y waba_id',
    en: 'WhatsApp needs phone_number_id and waba_id',
  },
  couldNotSaveToken: {
    es: 'No se pudo guardar el token',
    en: "Couldn't save the token",
  },
  connectedLabel: { es: 'Conectado: {label}', en: 'Connected: {label}' },
  connectWithToken: {
    es: 'Conectar {label} con token',
    en: 'Connect {label} with a token',
  },
  close: { es: 'Cerrar', en: 'Close' },
  cancel: { es: 'Cancelar', en: 'Cancel' },
  saveAndConnect: { es: 'Guardar y conectar', en: 'Save and connect' },

  // Assignment rules — kind labels
  ruleKindRoundRobin: { es: 'Round robin', en: 'Round robin' },
  ruleKindByTag: { es: 'Por etiqueta', en: 'By tag' },
  ruleKindByChannel: { es: 'Por canal', en: 'By channel' },
  ruleKindByKeyword: { es: 'Por palabra clave', en: 'By keyword' },

  // Assignment rules — kind hints
  ruleHintRoundRobin: {
    es: 'Rota la conversación entre los agentes seleccionados.',
    en: 'Rotates the conversation among the selected agents.',
  },
  ruleHintByTag: {
    es: 'Asigna al agente si el contacto tiene la etiqueta.',
    en: 'Assigns the agent if the contact has the tag.',
  },
  ruleHintByChannel: {
    es: 'Asigna al agente cuando la conversación viene del canal.',
    en: 'Assigns the agent when the conversation comes from the channel.',
  },
  ruleHintByKeyword: {
    es: 'Asigna al agente si el primer mensaje contiene la palabra.',
    en: 'Assigns the agent if the first message contains the word.',
  },

  // Assignment rules — toasts
  rulesLoadError: {
    es: 'No se cargaron las reglas',
    en: "Couldn't load the rules",
  },
  workspaceUnavailable: {
    es: 'Workspace no disponible',
    en: 'Workspace unavailable',
  },
  couldNotUpdate: { es: 'No se pudo actualizar', en: "Couldn't update" },
  deleteRuleConfirm: { es: '¿Eliminar regla?', en: 'Delete rule?' },
  couldNotDelete: { es: 'No se pudo eliminar', en: "Couldn't delete" },
  ruleDeleted: { es: 'Regla eliminada', en: 'Rule deleted' },
  giveItAName: { es: 'Ponle un nombre', en: 'Give it a name' },
  couldNotSave: { es: 'No se pudo guardar', en: "Couldn't save" },
  ruleUpdated: { es: 'Regla actualizada', en: 'Rule updated' },
  ruleCreated: { es: 'Regla creada', en: 'Rule created' },

  // Assignment rules — headings + descriptions
  assignmentRules: { es: 'Reglas de asignación', en: 'Assignment rules' },
  newRule: { es: 'Nueva regla', en: 'New rule' },
  noRulesYet: { es: 'Sin reglas todavía', en: 'No rules yet' },
  createFirstRule: { es: 'Crear primera regla', en: 'Create first rule' },

  // Assignment rules — row card
  anyChannel: { es: 'Cualquier canal', en: 'Any channel' },
  rulePriorityChannel: {
    es: 'Prioridad {priority} · {channel}',
    en: 'Priority {priority} · {channel}',
  },
  pauseRule: { es: 'Pausar regla', en: 'Pause rule' },
  activateRule: { es: 'Activar regla', en: 'Activate rule' },
  edit: { es: 'Editar', en: 'Edit' },

  // Assignment rules — editor modal
  anyOption: { es: 'Cualquiera', en: 'Any' },
  editRule: { es: 'Editar regla', en: 'Edit rule' },
  ruleNameLabel: { es: 'Nombre', en: 'Name' },
  ruleNamePlaceholder: {
    es: 'Ej: Repartir a soporte',
    en: 'E.g. Route to support',
  },
  ruleTypeLabel: { es: 'Tipo', en: 'Type' },
  ruleChannelLabel: { es: 'Canal', en: 'Channel' },
  ruleChannelHint: {
    es: 'La regla solo aplica a conversaciones de este canal.',
    en: 'The rule only applies to conversations from this channel.',
  },
  rulePriorityLabel: { es: 'Prioridad', en: 'Priority' },
  ruleActiveLabel: { es: 'Activa', en: 'Active' },
  agentIdsLabel: {
    es: 'IDs de agentes (separados por coma)',
    en: 'Agent IDs (comma-separated)',
  },
  tagIdLabel: { es: 'ID de etiqueta', en: 'Tag ID' },
  agentIdLabel: { es: 'ID de agente', en: 'Agent ID' },
  keywordLabel: { es: 'Palabra clave', en: 'Keyword' },
  targetChannelLabel: { es: 'Canal objetivo', en: 'Target channel' },
  selectPlaceholder: { es: 'Selecciona', en: 'Select' },
  save: { es: 'Guardar', en: 'Save' },

  // ── Comentario a DM (auto-DM on comments, migration 086) ──
  tabCommentToDm: { es: 'Comentario a DM', en: 'Comment to DM' },
  c2dmNew: { es: 'Nueva regla', en: 'New rule' },
  c2dmIgComment: { es: 'Comentarios de Instagram', en: 'Instagram comments' },
  c2dmFbComment: { es: 'Comentarios de Facebook', en: 'Facebook comments' },
  // Una regla que escucha las dos redes (migración 203): antes había que
  // escribirla dos veces y editarla dos veces cada vez que cambiaba el texto.
  c2dmBothComments: {
    es: 'Comentarios de Instagram y Facebook',
    en: 'Instagram and Facebook comments',
  },
  c2dmTtComment: { es: 'Comentarios de TikTok', en: 'TikTok comments' },
  c2dmKeywordsLabel: { es: 'Palabras clave', en: 'Keywords' },
  c2dmKeywordsHint: {
    es: 'Separadas por coma. Vacío: cualquier comentario.',
    en: 'Comma-separated. Empty: any comment.',
  },
  c2dmKeywordsPlaceholder: {
    es: 'precio, info, quiero',
    en: 'price, info, want',
  },
  c2dmKeywordsAny: { es: 'cualquier comentario', en: 'any comment' },
  c2dmDmMessageLabel: { es: 'Mensaje del DM', en: 'DM message' },
  c2dmDmMessagePlaceholder: {
    es: '¡Hola! Gracias por comentar 🙌 Te paso la info por aquí…',
    en: "Hi! Thanks for commenting 🙌 Here's the info you asked for…",
  },
  c2dmDmMessageRequired: {
    es: 'Escribe el mensaje del DM',
    en: 'Write the DM message',
  },
  c2dmAttachmentLabel: { es: 'Recurso (opcional)', en: 'Resource (optional)' },
  c2dmAttachmentHint: {
    es: 'Imagen, video o PDF: llega adjunto en el DM.',
    en: 'Image, video or PDF: it arrives attached in the DM.',
  },
  c2dmButtonLabelLabel: {
    es: 'Texto del enlace (opcional)',
    en: 'Link text (optional)',
  },
  c2dmButtonUrlLabel: { es: 'Enlace (opcional)', en: 'Link URL (optional)' },
  c2dmDmSentCount: { es: '{count} DM enviados', en: '{count} DMs sent' },
  // Sólo aparece si los hay: una regla que dispara y nunca entrega se leía
  // igual que una que nadie activó.
  c2dmDmFailedCount: { es: '{count} sin entregar', en: '{count} undelivered' },
  c2dmCreated: { es: 'Regla creada', en: 'Rule created' },
  c2dmUpdated: { es: 'Regla actualizada', en: 'Rule updated' },

  // ── Reglas: lista + editor rediseñados ──
  c2dmRulesTitle: { es: 'Reglas', en: 'Rules' },
  c2dmRulesHint: {
    es: 'Tus palabras exactas. Una regla manda sobre la IA.',
    en: 'Your exact words. A rule wins over the AI.',
  },
  c2dmEmpty: { es: 'Sin reglas.', en: 'No rules.' },
  c2dmActionReplyAndDm: { es: 'responde y manda DM', en: 'public reply + DM' },
  c2dmActionDmOnly: { es: 'manda DM', en: 'DM only' },
  // TikTok no tiene privado: la regla sólo puede publicar bajo el video.
  c2dmActionReplyOnly: {
    es: 'responde en el video',
    en: 'replies on the video',
  },
  c2dmOnePostOnly: { es: 'un solo post', en: 'one post only' },
  c2dmPostLabel: { es: 'Post', en: 'Post' },
  c2dmPostPlaceholder: { es: 'Todos los posts', en: 'All posts' },
  c2dmSectionWhen: { es: 'Cuándo', en: 'When' },
  c2dmSectionWhat: { es: 'Qué mandas', en: 'What you send' },
  c2dmPublicRepliesLabel: {
    es: 'Respuesta pública (opcional)',
    en: 'Public reply (optional)',
  },
  // En TikTok es lo único que la regla puede hacer, así que deja de ser opcional.
  c2dmPublicRepliesRequiredLabel: {
    es: 'Respuesta pública',
    en: 'Public reply',
  },
  c2dmPublicReplyRequired: {
    es: 'Escribe la respuesta que se publica',
    en: 'Write the reply that gets posted',
  },
  c2dmPublicRepliesHint: {
    es: 'Una por línea; rotamos al azar.',
    en: 'One per line; we rotate at random.',
  },
  c2dmRuleOptions: { es: 'Opciones de la regla', en: 'Rule options' },
  c2dmPreview: { es: 'Así se ve', en: 'How it looks' },
  c2dmPreviewPublic: { es: 'En el comentario', en: 'On the comment' },
  c2dmPreviewDm: { es: 'En el DM', en: 'In the DM' },

  tabBilling: { es: 'Plan', en: 'Plan' },

  // El permiso para que soporte lea las conversaciones. Lo abre el comercio.
  supportTitle: { es: 'Ayuda de soporte', en: 'Support access' },
  supportClosed: {
    es: 'Riverz no puede leer tus conversaciones. Si necesitas que revisemos una, abre el acceso por un rato.',
    en: 'Riverz cannot read your conversations. If you need us to look at one, open access for a while.',
  },
  supportOpenUntil: {
    es: 'Soporte puede leer tus conversaciones hasta el {fecha}.',
    en: 'Support can read your conversations until {fecha}.',
  },
  supportHours: { es: '{n} horas', en: '{n} hours' },
  supportDays: { es: '{n} días', en: '{n} days' },
  supportRevoke: { es: 'Cerrar el acceso', en: 'Close access' },
  supportError: { es: 'No se pudo cambiar.', en: 'Could not change it.' },

  // Facturación, en Ajustes.
  billingTitle: { es: 'Plan y facturación', en: 'Plan and billing' },
  billingPlan500: { es: 'Hasta 500 contactos', en: 'Up to 500 contacts' },
  billingPlanSaldoUnlimited: {
    es: 'Contactos ilimitados con saldo',
    en: 'Unlimited contacts with balance',
  },
  billingPlanByok: { es: 'Clave propia de IA', en: 'Own AI key' },
  billingSaldoUnlimitedCheckout: {
    es: 'El uso de la IA se descuenta del saldo que recargas por separado.',
    en: 'AI usage is deducted from a balance you fund separately.',
  },
  billingPlan2000: { es: 'Hasta 2.000 contactos', en: 'Up to 2,000 contacts' },
  billingPlan5000: { es: 'Hasta 5.000 contactos', en: 'Up to 5,000 contacts' },
  billingPlan10000: {
    es: 'Hasta 10.000 contactos',
    en: 'Up to 10,000 contacts',
  },
  billingMissingPrice: {
    es: 'Esta cuenta todavía no tiene un precio de suscripción activo.',
    en: 'This account does not have an active subscription price yet.',
  },
  billingPlanInactive: {
    es: 'Elige un plan activo antes de pagar.',
    en: 'Choose an active plan before paying.',
  },
  billingAlreadyActive: {
    es: 'Esta cuenta ya tiene una suscripción activa.',
    en: 'This account already has an active subscription.',
  },
  billingPaymentFailed: {
    es: 'No se pudo abrir el pago.',
    en: 'Could not open payment.',
  },
  billingTrial: {
    es: 'Te quedan {n} días de prueba.',
    en: '{n} days of trial left.',
  },
  billingTrialLast: {
    es: 'Hoy es el último día de prueba.',
    en: 'Today is the last day of your trial.',
  },
  billingExpired: {
    es: 'La prueba terminó. Pon una tarjeta para seguir.',
    en: 'Your trial ended. Add a card to continue.',
  },
  billingUnpaid: {
    es: 'Pago pendiente: la IA se activa cuando se complete.',
    en: 'Payment pending: the AI turns on once it goes through.',
  },
  billingActive: { es: 'Suscripción activa.', en: 'Subscription active.' },
  billingPastDue: {
    es: 'No pudimos cobrar. Revisa la tarjeta.',
    en: 'We could not charge you. Check your card.',
  },
  billingCanceled: {
    es: 'La suscripción está cancelada.',
    en: 'Your subscription is canceled.',
  },
  billingCancelAtEnd: {
    es: 'Se cancela al final del período.',
    en: 'It cancels at the end of the period.',
  },
  billingThisPeriod: { es: 'Este período', en: 'This period' },
  billingConversations: {
    es: '{n} de {total} conversaciones',
    en: '{n} of {total} conversations',
  },
  billingOver: {
    es: '{n} por encima del cupo',
    en: '{n} over the quota',
  },
  billingTotal: { es: 'Total', en: 'Total' },
  billingSubscribe: { es: 'Poner tarjeta', en: 'Add a card' },
  billingManage: { es: 'Administrar', en: 'Manage' },
  billingPerMonth: { es: 'Por mes', en: 'Per month' },
  billingFirstMonthDiscount: {
    es: 'Primer mes · {percent} % de descuento',
    en: 'First month · {percent}% off',
  },
  billingAfterFirstMonth: { es: 'Después, por mes', en: 'Then, per month' },
  billingModelLabel: { es: 'Sistema de cobro', en: 'Billing model' },
  billingAllIncluded: { es: 'Todo incluido', en: 'All included' },
  billingBalanceModel: { es: 'Saldo por consumo', en: 'Usage balance' },
  billingByokModel: { es: 'Tu propia clave de IA', en: 'Your own AI key' },
  billingByokNeedsKey: {
    es: 'Agrega tu clave de Anthropic para usar la IA. No necesitas recargar saldo en Riverz.',
    en: 'Add your Anthropic key to use AI. You do not need to top up your Riverz balance.',
  },
  billingByokConfigureKey: {
    es: 'Configurar clave de IA',
    en: 'Set up AI key',
  },
  billingServedContacts: {
    es: 'Contactos atendidos este período',
    en: 'Contacts served this period',
  },
  billingContactsOf: { es: '{n} de {total}', en: '{n} of {total}' },
  billingVolumeExceeded: {
    es: 'Llegaste al límite. La IA sigue con los contactos ya atendidos; los nuevos pasan a tu equipo hasta que amplíes. No hay cobros automáticos.',
    en: 'You reached the limit. AI continues with contacts already served; new ones go to your team until you upgrade. There are no automatic charges.',
  },
  billingNearLimit: {
    es: 'Te acercas al límite de contactos. Puedes ampliar tu plan ahora.',
    en: 'You are nearing your contact limit. You can upgrade now.',
  },
  billingUpgradePlan: { es: 'Nuevo plan', en: 'New plan' },
  billingUpgradeOption: {
    es: '{n} contactos · {price}/mes',
    en: '{n} contacts · {price}/month',
  },
  billingUpgradePreview: {
    es: 'Ver costo del cambio',
    en: 'Preview upgrade cost',
  },
  billingUpgradeConfirm: { es: 'Confirmar ampliación', en: 'Confirm upgrade' },
  billingUpgradeDueNow: {
    es: 'Capacidad adicional este ciclo: {amount}.',
    en: 'Additional capacity this cycle: {amount}.',
  },
  billingUpgradeNext: {
    es: 'Desde la próxima renovación: {amount}/mes.',
    en: 'From the next renewal: {amount}/month.',
  },
  billingUpgradeNoRetroactive: {
    es: 'El cupo total cambia ahora; los contactos ya atendidos siguen contando. Tu fecha de renovación no cambia.',
    en: 'Your total capacity changes now; contacts already served still count. Your renewal date stays the same.',
  },
  billingUpgradeFirstMonth: {
    es: 'El 35 % del primer mes solo aplica al plan contratado inicialmente.',
    en: 'The first-month 35% discount applies only to the plan you originally purchased.',
  },
  billingUpgradeShopify: {
    es: 'Shopify mostrará el cargo proporcional antes de que lo apruebes.',
    en: 'Shopify will show the prorated charge before you approve it.',
  },
  billingUpgradeTrial: {
    es: 'Sin cobro ahora. El nuevo plan aplicará al suscribirte.',
    en: 'Nothing due now. The new plan applies when you subscribe.',
  },
  billingUpgradeQuoteExpired: {
    es: 'El importe cambió. Vuelve a revisar el costo antes de confirmar.',
    en: 'The amount changed. Preview the cost again before confirming.',
  },
  billingUpgradePending: {
    es: 'Pago recibido. Estamos actualizando tu plan.',
    en: 'Payment received. We are updating your plan.',
  },
  billingUpgradeSuccess: { es: 'Plan ampliado.', en: 'Plan upgraded.' },
  billingUpgradeFailed: {
    es: 'No se pudo ampliar el plan.',
    en: 'Could not upgrade the plan.',
  },
  billingUpgradeUnavailable: {
    es: 'Este cambio de plan no está disponible.',
    en: 'This plan change is unavailable.',
  },
  billingContactForUpgrade: {
    es: 'Solicitar mayor volumen',
    en: 'Request more volume',
  },
  billingNearTitle: {
    es: 'Tu plan se acerca al límite',
    en: 'Your plan is nearing its limit',
  },
  billingNearMessage: {
    es: 'Ya atendimos {n} de {total} contactos este período. Puedes ampliar el plan en riverz.co/ajustes?tab=billing. Verás el cargo exacto antes de confirmar.',
    en: 'We have served {n} of {total} contacts this period. You can upgrade at riverz.co/settings?tab=billing. You will see the exact charge before confirming.',
  },
  billingLimitTitle: {
    es: 'Llegaste al límite de contactos',
    en: 'You reached your contact limit',
  },
  billingLimitMessage: {
    es: 'Ya atendimos {n} de {total} contactos este período. La IA sigue con ellos; los contactos nuevos pasan a tu equipo. Amplía en riverz.co/ajustes?tab=billing. No hay cobros automáticos.',
    en: 'We have served {n} of {total} contacts this period. AI continues with them; new contacts go to your team. Upgrade at riverz.co/settings?tab=billing. There are no automatic charges.',
  },
  billingRenewsOn: { es: 'Se renueva el', en: 'Renews on' },
  billingEndsOn: { es: 'Termina el', en: 'Ends on' },
  billingCancel: { es: 'Cancelar suscripción', en: 'Cancel subscription' },
  billingCancelConfirm: {
    es: 'Se cancela al final del período ya pagado. Hasta entonces todo sigue funcionando.',
    en: 'It cancels at the end of the period you already paid. Everything keeps working until then.',
  },
  billingResume: { es: 'Reanudar suscripción', en: 'Resume subscription' },

  // ── Billetera ──
  tabWallet: { es: 'Saldo', en: 'Balance' },
  walletBalance: { es: 'Saldo disponible', en: 'Available balance' },
  walletStripeFeeRate: {
    es: 'Incluida, sin descuento del saldo',
    en: 'Included, no balance deduction',
  },
  walletActualUsageRate: { es: 'Costo real por uso', en: 'Actual usage cost' },
  walletReserved: {
    es: '{amount} reservado para operaciones en curso.',
    en: '{amount} reserved for operations in progress.',
  },
  walletTopupAdjustment: { es: 'Ajuste de recarga', en: 'Top-up adjustment' },
  walletStripeFee: { es: 'Comisión de Stripe', en: 'Stripe processing fee' },
  walletTopUp: { es: 'Recarga', en: 'Top-up' },
  walletTopupHistory: { es: 'Historial de recargas', en: 'Top-up history' },
  walletTopupDate: { es: 'Fecha y hora', en: 'Date and time' },
  walletTopupOrigin: { es: 'Tipo', en: 'Type' },
  walletTopupAmount: { es: 'Importe', en: 'Amount' },
  walletTopupOrigin_manual: { es: 'Manual', en: 'Manual' },
  walletTopupOrigin_automatica: { es: 'Automática', en: 'Automatic' },
  walletTopupOrigin_desconocida: { es: 'Sin especificar', en: 'Unspecified' },
  walletNoTopups: { es: 'Todavía no hay recargas.', en: 'No top-ups yet.' },
  walletTopupHistoryFailed: {
    es: 'No se pudo cargar el historial de recargas.',
    en: 'Could not load top-up history.',
  },
  walletTopUpFailed: {
    es: 'No se pudo abrir la recarga.',
    en: "Couldn't open the top-up.",
  },
  walletOther: { es: 'Otro', en: 'Other' },
  walletMin: { es: 'Mínimo US$3', en: 'Minimum US$3' },
  // Errores del servidor. Van acá y no como texto suelto en la ruta porque el
  // toast que los muestra es el mismo que ve un comercio en inglés.
  walletAmountRange: {
    es: 'El monto tiene que estar entre {min} y {max}.',
    en: 'The amount has to be between {min} and {max}.',
  },
  walletThresholdBelow: {
    es: 'El umbral tiene que ser menor que el monto de la recarga.',
    en: 'The threshold has to be lower than the top-up amount.',
  },
  walletIncludedNoTopup: {
    es: 'Tu plan incluye el consumo y no necesita recargas.',
    en: 'Your plan includes usage and does not need top-ups.',
  },
  alertPhonesLabel: {
    es: 'A qué números avisamos',
    en: 'Which numbers we notify',
  },
  alertPhonesHint: {
    es: 'Hasta tres. Aquí llegan los avisos de Riverz: saldo, cobros y los casos que necesitan una persona.',
    en: 'Up to three. Riverz alerts land here: balance, charges and the cases that need a person.',
  },
  alertPhonesSaved: { es: 'Números guardados', en: 'Numbers saved' },
  walletCardRemove: { es: 'Quitar tarjeta', en: 'Remove card' },
  walletCardRemoved: {
    es: 'Tarjeta quitada. La recarga automática queda apagada.',
    en: 'Card removed. Auto top-up is now off.',
  },
  walletCardRemoveConfirm: {
    es: 'Se quita la tarjeta y se apaga la recarga automática. Cuando el saldo llegue a cero, la IA se pausa.',
    en: 'This removes the card and turns off auto top-up. When the balance hits zero, the AI pauses.',
  },
  walletEmpty: {
    es: 'Te quedaste sin saldo. La cuenta sigue funcionando, pero conviene recargar.',
    en: "You're out of balance. The account still works, but it's worth topping up.",
  },
  walletEmptyBlocking: {
    es: 'Te quedaste sin saldo y la IA dejó de responder. Recarga para reanudar.',
    en: "You're out of balance and the AI stopped replying. Top up to resume.",
  },
  walletToday: { es: 'Hoy', en: 'Today' },
  walletYesterday: { es: 'Ayer', en: 'Yesterday' },
  walletLastDays: { es: '{n} días', en: '{n} days' },
  walletCustomRange: { es: 'Personalizado', en: 'Custom' },
  walletUsage: { es: 'Uso', en: 'Usage' },
  walletSpent: { es: 'Gastado', en: 'Spent' },
  walletLoaded: { es: 'Recargado', en: 'Added' },
  walletByDay: { es: 'Gasto por día', en: 'Spend per day' },
  walletByConcept: { es: 'En qué se fue', en: 'Where it went' },
  walletNoSpend: {
    es: 'Sin consumo en este rango.',
    en: 'No usage in this range.',
  },
  walletLedger: { es: 'Movimientos', en: 'Transactions' },
  walletNoMovements: {
    es: 'Sin movimientos en este rango.',
    en: 'No movements in this range.',
  },
  walletBalanceAfter: { es: 'Saldo: {saldo}', en: 'Balance: {saldo}' },
  walletClearFilter: { es: 'Ver todo', en: 'Show all' },
  walletPrev: { es: 'Anterior', en: 'Previous' },
  walletNext: { es: 'Siguiente', en: 'Next' },
  walletRates: { es: 'Cuánto sale cada cosa', en: 'What each thing costs' },
  walletYourAverage: { es: 'tu promedio', en: 'your average' },
  walletAtCostNote: {
    es: 'Tu cuenta paga el costo real, sin margen: esto es exactamente lo que se te descuenta.',
    en: 'Your account pays the real cost, with no margin: this is exactly what gets deducted.',
  },
  walletEstimate: { es: 'estimado', en: 'estimate' },
  walletNoCharge: { es: 'Sin cargo', en: 'No charge' },

  // ── El cartel cuando alguien pide IA y no hay saldo ──
  sinSaldoTitulo: { es: 'Te quedaste sin saldo', en: "You're out of balance" },
  sinSaldoCuerpo: {
    es: 'La IA se pausó hasta que recargues. La bandeja sigue abierta para contestar a mano.',
    en: 'The AI is paused until you top up. The inbox is still open to answer manually.',
  },
  sinSaldoCta: { es: 'Recargar saldo', en: 'Top up' },
  sinSaldoCerrar: { es: 'Ahora no', en: 'Not now' },
  sinPagarTitulo: { es: 'La IA está en pausa', en: 'The AI is paused' },
  sinPagarCuerpo: {
    es: 'Se activa cuando se complete el pago. La bandeja sigue abierta para contestar a mano.',
    en: 'It turns on once the payment goes through. The inbox is still open to answer manually.',
  },
  sinPagarCerrar: { es: 'Entendido', en: 'Got it' },
  sinSaldoPlanTitulo: {
    es: 'Tu plan necesita atención',
    en: 'Your plan needs attention',
  },
  sinSaldoPlanCuerpo: {
    es: 'El cobro del plan no entró, así que la IA está pausada. Actualiza el pago y vuelve todo.',
    en: "The plan charge didn't go through, so the AI is paused. Update your payment and it all comes back.",
  },
  sinSaldoPlanCta: { es: 'Actualizar pago', en: 'Update payment' },

  // ── Lo que sale FUERA de la app: el checkout de Stripe y los avisos por
  //    WhatsApp. Van acá y no en el componente porque los escribe el servidor,
  //    a veces desde un cron donde no hay pantalla ni cookie de idioma.
  walletProductName: { es: 'Saldo Riverz', en: 'Riverz balance' },
  walletProductDesc: {
    es: 'El importe completo se acredita como saldo.',
    en: 'The full amount is credited to your balance.',
  },
  avisoSaldoBajoTitulo: {
    es: 'Saldo bajo: {saldo}',
    en: 'Low balance: {saldo}',
  },
  avisoSaldoBajoCuerpo: {
    es: 'La IA se pausará cuando el saldo llegue a cero. Recarga: riverz.co/ajustes?tab=saldo',
    en: 'AI replies will pause when the balance reaches zero. Top up: riverz.co/settings?tab=saldo',
  },
  avisoSinSaldoTitulo: {
    es: 'IA pausada por saldo',
    en: 'AI paused: no balance',
  },
  avisoSinSaldoCuerpo: {
    es: 'Puedes seguir respondiendo manualmente. Para reactivar la IA, recarga: riverz.co/ajustes?tab=saldo',
    en: 'You can still reply manually. To reactivate AI replies, top up: riverz.co/settings?tab=saldo',
  },
  avisoRecargaAutoFalloTitulo: {
    es: 'Falló la recarga automática',
    en: 'Automatic top-up failed',
  },
  avisoRecargaAutoFalloCuerpo: {
    es: 'No se pudo recargar y quedan {saldo}. Revisa la tarjeta o recarga manualmente: riverz.co/ajustes?tab=saldo',
    en: 'The top-up failed and {saldo} remains. Check the card or top up manually: riverz.co/settings?tab=saldo',
  },
  avisoEscaladaCliente: { es: 'Cliente', en: 'Customer' },
  avisoEscaladaUrgenteTitulo: {
    es: '{cliente}: atención urgente',
    en: '{cliente}: urgent attention',
  },
  avisoEscaladaTitulo: {
    es: '{cliente}: atención necesaria',
    en: '{cliente}: attention needed',
  },
  avisoEscaladaMotivo: { es: 'Motivo: {motivo}', en: 'Reason: {motivo}' },
  avisoEscaladaCanal: {
    es: 'Canal: {canal}{contacto}',
    en: 'Channel: {canal}{contacto}',
  },
  avisoEscaladaUltimoMensaje: {
    es: 'Último mensaje: {mensaje}',
    en: 'Latest message: {mensaje}',
  },
  avisoEscaladaImagen: { es: 'envió una imagen', en: 'sent an image' },
  avisoEscaladaPedido: {
    es: 'Pedido: {pedido}{estado}',
    en: 'Order: {pedido}{estado}',
  },
  avisoEscaladaEspera: { es: 'Espera: {horas} h', en: 'Waiting: {horas}h' },
  avisoEscaladaAbrir: {
    es: 'Abrir conversación: {enlace}',
    en: 'Open conversation: {enlace}',
  },
  avisoEscaladaPausa: {
    es: 'La IA está pausada en este chat.',
    en: 'AI replies are paused in this chat.',
  },
  avisoPlanFalloTitulo: {
    es: 'No pudimos cobrar tu plan',
    en: "We couldn't charge your plan",
  },
  avisoPlanFalloCuerpo: {
    es: 'El cobro del plan no entró. Tienes {horas} horas para actualizar el pago antes de perder el acceso: riverz.co/ajustes?tab=billing',
    en: "The plan charge didn't go through. You have {horas} hours to update your payment before losing access: riverz.co/ajustes?tab=billing",
  },
  avisoPlanPausadaTitulo: {
    es: 'Tu cuenta está pausada',
    en: 'Your account is paused',
  },
  avisoPlanPausadaCuerpo: {
    es: 'El cobro del plan no entró y la cuenta quedó pausada. Pon una tarjeta y vuelve todo enseguida: riverz.co/ajustes?tab=billing',
    en: "The plan charge didn't go through and the account is paused. Add a card and everything comes back right away: riverz.co/ajustes?tab=billing",
  },
  avisoActivoTitulo: { es: 'Tu plan quedó activo', en: 'Your plan is active' },
  avisoActivoCuerpo: {
    es: 'El pago entró y la cuenta está al día. Tu saldo para la IA es de {saldo}, lo ves y lo recargas en riverz.co/ajustes?tab=saldo',
    en: 'The payment went through and your account is up to date. Your AI balance is {saldo}, check it and top it up at riverz.co/ajustes?tab=saldo',
  },
  walletInsideOf: { es: 'Dentro de «{linea}»', en: 'Inside “{linea}”' },

  // ── Recarga automática ──
  walletAutoTitle: { es: 'Recarga automática', en: 'Auto top-up' },
  walletAutoOn: {
    es: 'Se cargan {monto} cuando el saldo baja de {umbral}.',
    en: '{monto} is charged whenever the balance drops below {umbral}.',
  },
  walletCardAdd: { es: 'Agregar tarjeta', en: 'Add card' },
  walletCardChange: { es: 'Cambiar tarjeta', en: 'Change card' },
  walletAutoAmount: { es: 'Cargar (US$)', en: 'Load (US$)' },
  walletAutoThreshold: {
    es: 'Cuando baje de (US$)',
    en: 'When it drops below (US$)',
  },
  walletAutoSave: { es: 'Guardar', en: 'Save' },
  walletAutoTurnOff: { es: 'Apagar', en: 'Turn off' },
  walletAutoSaved: { es: 'Listo.', en: 'Done.' },
  walletAutoFailed: {
    es: 'El último cobro automático no entró. Se vuelve a intentar.',
    en: "The last automatic charge didn't go through. It will retry.",
  },
  walletAutoGaveUp: {
    es: 'El cobro automático falló tres veces y se detuvo. Cambia la tarjeta para reanudarlo.',
    en: 'Auto top-up failed three times and stopped. Change the card to resume it.',
  },

  // ── Avisos de cobro ──
  avisoGracia: {
    es: 'Un pequeño recordatorio: tu mensualidad está pendiente. Puedes completar el pago aquí. Tu IA seguirá activa durante las próximas {n} horas.',
    en: 'A little reminder: your monthly payment is pending. You can complete the payment here. Your AI will stay active for the next {n} hours.',
  },
  avisoGraciaCta: { es: 'Completar pago', en: 'Complete payment' },
  avisoMensualidadPausada: {
    es: 'Tu cuenta está en modo lectura por ahora. Los mensajes y comentarios siguen llegando. Completa la mensualidad para volver a editar, responder y usar tu IA. Tu saldo se conserva.',
    en: 'Your account is read-only for now. Messages and comments are still arriving. Complete your monthly payment to edit, reply and use AI again. Your balance is preserved.',
  },
  avisoSinSaldo: {
    es: 'Te quedaste sin saldo: la IA dejó de responder. La bandeja sigue abierta para contestar a mano.',
    en: "You're out of balance: the AI stopped replying. The inbox is still open to answer manually.",
  },
  avisoSinSaldoCta: { es: 'Recargar', en: 'Top up' },
  avisoSinPagar: {
    es: 'La IA está en pausa hasta que se complete el pago. La bandeja sigue abierta para contestar a mano.',
    en: 'The AI is paused until the payment goes through. The inbox is still open to answer manually.',
  },
  impagoTitle: { es: 'La cuenta está pausada', en: 'Your account is paused' },
  readOnlyTitle: { es: 'Tu cuenta está en modo lectura', en: 'Your account is read-only' },
  billingRecoveryReview: {es:'Esta conversación quedó pendiente durante la pausa de mensualidad. Revísala antes de responder; puede tener una respuesta desde otra aplicación o necesitar atención manual.',en:'This conversation was pending during the monthly payment pause. Review it before replying; it may have been answered from another app or need manual attention.'},
  readOnlyComposer: { es: 'Completa la mensualidad para volver a responder.', en: 'Complete your monthly payment to reply again.' },
  readOnlyBody: {
    es: 'Tus mensajes y comentarios siguen llegando. Completa la mensualidad para volver a editar, responder y usar tu IA. Tu saldo y tus datos se conservan.',
    en: 'Messages and comments are still arriving. Complete your monthly payment to edit, reply and use AI again. Your balance and data are preserved.',
  },
  billingStateUnavailable: { es: 'No pudimos comprobar el pago. Intenta de nuevo en un momento.', en: 'We could not verify the payment. Please try again shortly.' },
  billingPendingTitle: { es: 'Un pequeño recordatorio de tu mensualidad', en: 'A friendly reminder about your monthly payment' },
  billingPendingBody: {
    es: 'Hola, {nombre}. Tu mensualidad está pendiente. Puedes completar el pago aquí: {url}. Tienes hasta {fecha} para seguir usando Riverz con normalidad. Después, tu cuenta quedará en modo lectura: seguirás recibiendo mensajes y comentarios, pero no podrás editar, responder ni usar la IA. Tu saldo y tus datos se conservan.',
    en: 'Hi, {nombre}. Your monthly payment is pending. You can complete it here: {url}. You have until {fecha} to keep using Riverz as usual. After that, your account becomes read-only: messages and comments will still arrive, but editing, replies and AI will pause. Your balance and data are preserved.',
  },
  billingPausedTitle: { es: 'Tu cuenta está en modo lectura por ahora', en: 'Your account is read-only for now' },
  billingReminder6Title: { es: 'Un recordatorio antes de que termine tu plazo', en: 'A reminder before your grace period ends' },
  billingReminder6Body: {
    es: 'Hola, {nombre}. Te recordamos con tiempo que tu mensualidad sigue pendiente. El plazo de gracia termina a las {fecha}. Puedes completar el pago aquí: {url} para seguir editando, respondiendo y usando tu IA sin interrupciones. Si ya pagaste, actualizaremos tu cuenta en cuanto se confirme.',
    en: 'Hi, {nombre}. A friendly reminder that your monthly payment is still pending. Your grace period ends at {fecha}. Complete your payment here: {url} to keep editing, replying and using AI without interruption. If you have already paid, your account will update as soon as it is confirmed.',
  },
  billingReminder1Title: { es: 'Tu plazo de gracia está por terminar', en: 'Your grace period is ending soon' },
  billingReminder1Body: {
    es: 'Hola, {nombre}. Tu mensualidad todavía aparece pendiente y el plazo de gracia termina a las {fecha}. Puedes ponerte al día aquí: {url}. Después, Riverz quedará en modo lectura hasta que se confirme el pago. Tus mensajes y comentarios seguirán llegando y tu saldo se conservará.',
    en: 'Hi, {nombre}. Your monthly payment still appears pending and your grace period ends at {fecha}. You can get up to date here: {url}. After that, Riverz will be read-only until payment is confirmed. Messages and comments will keep arriving and your balance will be preserved.',
  },
  billingPausedBody: {
    es: 'Hola, {nombre}. Tu mensualidad sigue pendiente y terminó tu plazo de gracia. Puedes seguir consultando Riverz y recibiendo mensajes y comentarios. Las ediciones, las respuestas manuales y la IA están en pausa. Completa el pago aquí: {url}. Al confirmarse, todo se habilitará automáticamente y revisaremos los mensajes pendientes, sin repetir respuestas que ya hayas enviado desde tus aplicaciones.',
    en: 'Hi, {nombre}. Your monthly payment is still pending and your grace period has ended. You can still view Riverz and receive messages and comments. Editing, manual replies and AI are paused. Complete your payment here: {url}. Once confirmed, access resumes automatically and we review pending messages without repeating replies you already sent from your apps.',
  },
  billingActiveTitle: { es: 'Tu mensualidad ya está al día', en: 'Your monthly payment is up to date' },
  billingActiveBody: {
    es: 'Hola, {nombre}. Gracias, tu mensualidad ya está al día y se levantó la pausa por pago. Tu configuración y tu saldo se conservan. Revisaremos las conversaciones pendientes para que tu IA atienda las que sigan sin respuesta, cuando esté habilitada y tengas saldo disponible, según lo que permita cada canal. Las respuestas enviadas desde tus aplicaciones se tendrán en cuenta. Puedes ver todo en tu bandeja: {url}.',
    en: 'Hi, {nombre}. Thank you, your monthly payment is up to date and the payment pause has been lifted. Your settings and balance are preserved. We will review pending conversations so your AI can handle those still unanswered, when enabled and with available credit, according to each channel’s permissions. Replies sent from your apps will be taken into account. View everything in your inbox: {url}.',
  },
  impagoBody: {
    es: 'Tu suscripción necesita un pago para continuar. Completa el pago para reactivar tu cuenta.',
    en: 'Your subscription needs a payment to continue. Complete the payment to reactivate your account.',
  },
  impagoCta: { es: 'Pagar ahora', en: 'Pay now' },
  impagoError: {
    es: 'No se pudo abrir el pago. Intenta de nuevo.',
    en: "Couldn't open the payment. Try again.",
  },
  // El pie del correo. Vacío = sin firma: el correo sale como salía. No se
  // inventa una con el nombre del negocio — firmar en nombre de alguien es
  // decisión suya, no nuestra.
  signaturePlaceholder: {
    es: 'Firma al pie de los correos (opcional)',
    en: 'Signature at the bottom of your emails (optional)',
  },
  signatureSaved: { es: 'Firma guardada', en: 'Signature saved' },
  signatureFailed: {
    es: 'No se pudo guardar la firma',
    en: "Couldn't save the signature",
  },
  readApi_not_found: { es: 'Recurso no disponible', en: 'Resource unavailable' },
  readApi_unauthorized: { es: 'Clave de integración inválida', en: 'Invalid integration key' },
  readApi_forbidden: { es: 'No tienes permiso para consultar este recurso', en: 'You do not have permission to read this resource' },
  readApi_invalid: { es: 'Parámetros de consulta inválidos', en: 'Invalid query parameters' },
  readApi_limited: { es: 'Límite de consultas alcanzado', en: 'Request limit reached' },
  readApi_unavailable: { es: 'No se pudo confirmar la consulta', en: 'The query could not be confirmed' },
} satisfies Namespace;
