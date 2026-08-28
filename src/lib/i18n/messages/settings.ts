import type { Namespace } from "./types";

/** Settings page: tabs, appearance and the language picker. */
export const settings = {
  title: { es: "Ajustes", en: "Settings" },
  integrations: { es: "Integraciones", en: "Integrations" },

  // Tabs
  tabProfile: { es: "Perfil", en: "Profile" },
  tabWorkspace: { es: "Equipo", en: "Team" },
  tabAppearance: { es: "Apariencia", en: "Appearance" },

  // Appearance
  appearance: { es: "Apariencia", en: "Appearance" },
  themeLight: { es: "Claro", en: "Light" },
  themeLightTagline: {
    es: "Crema editorial — superficies cálidas, tinta carbón, acento lima.",
    en: "Editorial cream — warm surfaces, charcoal ink, lime accent.",
  },
  themeDark: { es: "Oscuro", en: "Dark" },
  themeDarkTagline: {
    es: "Carbón profundo — ideal para sesiones largas y poca luz.",
    en: "Deep charcoal — built for long sessions and low light.",
  },
  useTheme: { es: "Usar el tema {name}", en: "Use the {name} theme" },
  themeId: { es: "ID del tema: {id}", en: "Theme ID: {id}" },

  // Language
  language: { es: "Idioma", en: "Language" },
  useLanguage: { es: "Usar {name}", en: "Use {name}" },

  // Settings page header
  backToSettings: { es: "Volver a Ajustes", en: "Back to Settings" },
  configuration: { es: "Configuración", en: "Configuration" },

  // Píxel de Meta. La descripción dice el PROBLEMA y no la tecnología: quien
  // vende contra-entrega no busca "API de Conversiones", busca por qué sus
  // ventas no aparecen en el administrador de anuncios.
  metaPixelTitle: { es: "Píxel de Meta", en: "Meta Pixel" },
  metaPixelDescription: {
    es: "Las ventas del chat no pasan por el checkout. Con esto Meta las ve y tus campañas optimizan con datos reales.",
    en: "Chat sales never reach the checkout. This reports them so your campaigns optimize on real data.",
  },
  metaPixelIdPlaceholder: { es: "ID del píxel", en: "Pixel ID" },
  metaPixelTokenPlaceholder: {
    es: "Token de la API de Conversiones",
    en: "Conversions API access token",
  },
  metaPixelConnected: { es: "Píxel conectado", en: "Pixel connected" },
  metaPixelDisconnect: { es: "Desconectar el píxel", en: "Disconnect pixel" },
  metaPixelDisconnected: { es: "Píxel desconectado", en: "Pixel disconnected" },
  // El número es lo único que distingue un píxel que funciona de uno conectado
  // con el token vencido: los dos dicen "conectado".
  metaPixelCounted: {
    es: "{n} ventas contadas · 30 días",
    en: "{n} sales counted · 30 days",
  },
  metaPixelNoneYet: {
    es: "Todavía sin ventas que contar",
    en: "No sales to report yet",
  },
  metaPixelPending: { es: "{n} sin enviar", en: "{n} not sent" },
  // Al conectar se recupera lo de la semana anterior, que es el limite de Meta.
  metaPixelRecovered: {
    es: "Recuperamos {n} ventas de los últimos 7 días",
    en: "Recovered {n} sales from the last 7 days",
  },

  // Klaviyo card
  klaviyoDescription: {
    es: "Tus contactos y lo que compran, en tu lista. Sus segmentos, aquí como etiquetas.",
    en: "Your contacts and what they buy, in your list. Their segments, here as tags.",
  },
  klaviyoHookHint: {
    es: "Pega esta URL en la acción \"Webhook\" de un flujo de Klaviyo para que ese flujo mande un WhatsApp. En el cuerpo: phone, template y variables.",
    en: "Paste this URL into a Klaviyo flow's \"Webhook\" action so that flow sends a WhatsApp. Body: phone, template and variables.",
  },
  klaviyoHookCopy: { es: "Copiar URL", en: "Copy URL" },
  klaviyoHookCopied: { es: "URL copiada", en: "URL copied" },
  connected: { es: "Conectado", en: "Connected" },
  klaviyoInvalidKey: {
    es: "Pega una API key válida de Klaviyo.",
    en: "Paste a valid Klaviyo API key.",
  },
  klaviyoConnectError: {
    es: "No se pudo conectar Klaviyo",
    en: "Couldn't connect Klaviyo",
  },
  klaviyoConnected: { es: "Klaviyo conectado", en: "Klaviyo connected" },
  networkError: { es: "Error de red", en: "Network error" },
  disconnectError: { es: "No se pudo desconectar", en: "Couldn't disconnect" },
  connectionsLoadError: {
    es: "No se pudieron cargar tus conexiones",
    en: "Couldn't load your connections",
  },
  klaviyoDisconnected: { es: "Klaviyo desconectado", en: "Klaviyo disconnected" },

  // Mercado Pago card
  mpDescription: {
    es: "Trae los pagos rechazados para escribirle por WhatsApp a quien no llegó a comprar.",
    en: "Pulls declined payments so you can WhatsApp the people who didn't get to buy.",
  },
  mpInvalidToken: {
    es: "Pega tu Access Token de producción de Mercado Pago.",
    en: "Paste your Mercado Pago production Access Token.",
  },
  mpConnectError: {
    es: "No se pudo conectar Mercado Pago",
    en: "Couldn't connect Mercado Pago",
  },
  mpConnected: { es: "Mercado Pago conectado", en: "Mercado Pago connected" },
  mpDisconnected: { es: "Mercado Pago desconectado", en: "Mercado Pago disconnected" },
  mpNotifyUrlLabel: {
    es: "Pega esta URL en Mercado Pago → Tus integraciones → Webhooks, evento \"Pagos\", para que los rechazos lleguen al instante.",
    en: "Paste this URL in Mercado Pago → Your integrations → Webhooks, event \"Payments\", so declines arrive instantly.",
  },
  mpNotifyUrlSummary: {
    es: "Conectar pegando la URL de avisos",
    en: "Connect by pasting the notifications URL",
  },
  mpNotifyUrlCopy: { es: "Copiar URL", en: "Copy URL" },
  mpNotifyUrlCopied: { es: "URL copiada", en: "URL copied" },
  mpRenewFailed: {
    es: "No pudimos renovar la conexión con Mercado Pago. Vuelve a conectarla o la recuperación de pagos va a dejar de funcionar.",
    en: "We couldn't renew the Mercado Pago connection. Reconnect it or payment recovery will stop working.",
  },
  mpExpiringSoon: {
    es: "Tu acceso a Mercado Pago vence el {date}. Vuelve a conectarlo para que la recuperación siga andando.",
    en: "Your Mercado Pago access expires on {date}. Reconnect it to keep recovery running.",
  },
  mpReconnect: { es: "Volver a conectar", en: "Reconnect" },
  mpUpgradeHint: {
    es: "Autoriza la aplicación y se renueva sola, sin pegar ninguna URL.",
    en: "Authorize the app and it renews itself, with no URL to paste.",
  },
  mpUpgradeCta: { es: "Conectar con un clic", en: "Connect with one click" },
  connectResultOk: { es: "Cuenta conectada", en: "Account connected" },
  connectResultError: { es: "No se pudo conectar", en: "Couldn't connect" },
  connectResultCancelled: {
    es: "Conexión cancelada",
    en: "Connection cancelled",
  },
  connectResultRetry: {
    es: "La autorización venció. Vuelve a darle a Conectar.",
    en: "The authorization expired. Hit Connect again.",
  },
  mpDisconnect: { es: "Desconectar Mercado Pago", en: "Disconnect Mercado Pago" },
  replaceApiKeyPlaceholder: {
    es: "Reemplazar API key…",
    en: "Replace API key…",
  },
  update: { es: "Actualizar", en: "Update" },
  disconnectKlaviyo: { es: "Desconectar Klaviyo", en: "Disconnect Klaviyo" },
  klaviyoApiKeyPlaceholder: {
    es: "Klaviyo Private API key (pk_…)",
    en: "Klaviyo Private API key (pk_…)",
  },

  // Meta business login
  metaConnectError: { es: "No se pudo conectar", en: "Couldn't connect" },
  metaConnectedAccounts: {
    es: "Conectado: {n} cuenta(s)",
    en: "Connected: {n} account(s)",
  },
  metaNoAccounts: {
    es: "No se encontraron cuentas para conectar",
    en: "No accounts found to connect",
  },
  metaConnectionCancelled: { es: "Conexión cancelada", en: "Connection cancelled" },
  addAnotherAccount: { es: "Añadir otra cuenta", en: "Add another account" },
  chooseAccountsToConnect: {
    es: "Elige las cuentas a conectar",
    en: "Choose the accounts to connect",
  },
  connectSelected: {
    es: "Conectar seleccionadas ({n})",
    en: "Connect selected ({n})",
  },

  // Profile form
  profileTitle: { es: "Perfil", en: "Profile" },
  avatarInvalidType: {
    es: "Usa PNG, JPG, WebP o GIF.",
    en: "Use PNG, JPG, WebP or GIF.",
  },
  avatarTooLarge: { es: "Máximo 2 MB.", en: "Maximum 2 MB." },
  nameMissing: { es: "Falta el nombre.", en: "Name is missing." },
  emailInvalid: { es: "Correo inválido.", en: "Invalid email." },
  uploadFailed: { es: "Falló la subida: {message}", en: "Upload failed: {message}" },
  saveFailed: { es: "No se pudo guardar: {message}", en: "Couldn't save: {message}" },
  emailChangeFailed: {
    es: "No se pudo cambiar el correo: {message}",
    en: "Couldn't change the email: {message}",
  },
  genericError: { es: "Error", en: "Error" },
  savedEmailConfirm: {
    es: "Guardado — confirma el cambio de correo desde tu bandeja",
    en: "Saved — confirm the email change from your inbox",
  },
  avatarAlt: { es: "Avatar", en: "Avatar" },
  changePhoto: { es: "Cambiar foto", en: "Change photo" },
  uploadPhoto: { es: "Subir foto", en: "Upload photo" },
  displayName: { es: "Nombre para mostrar", en: "Display name" },
  emailLabel: { es: "Correo", en: "Email" },
  tabMcp: { es: "Agentes (MCP)", en: "Agents (MCP)" },
  mcpTitle: { es: "Agentes (MCP)", en: "Agents (MCP)" },
  mcpDesc: {
    es: "Conecta tu asistente de IA a esta cuenta.",
    en: "Connect your AI assistant to this account.",
  },
  mcpStep1: { es: "Crea una llave", en: "Create a key" },
  mcpStep2: { es: "Pégala en tu asistente", en: "Paste it into your assistant" },
  mcpDocs: { es: "Ver documentación", en: "View documentation" },
  mcpCreate: { es: "Crear llave", en: "Create key" },
  mcpNamePlaceholder: { es: "Para qué es (mi laptop, n8n…)", en: "What it is for (my laptop, n8n…)" },
  mcpCopyNow: {
    es: "Cópiala ahora: es la única vez que se muestra.",
    en: "Copy it now: this is the only time it is shown.",
  },
  mcpHideToken: { es: "Ya la guardé", en: "I saved it" },
  mcpLastUsed: { es: "usada {when}", en: "used {when}" },
  mcpNeverUsed: { es: "sin usar", en: "never used" },
  mcpRevoke: { es: "Revocar", en: "Revoke" },
  mcpRevoked: { es: "Llave revocada", en: "Key revoked" },
  mcpRevokeFailed: { es: "No se pudo revocar", en: "Couldn't revoke" },
  mcpCreateFailed: { es: "No se pudo crear", en: "Couldn't create" },
  mcpNoKeys: { es: "Todavía no hay ninguna llave.", en: "No keys yet." },
  mcpTooMany: {
    es: "Ya hay diez llaves activas. Revoca alguna antes de crear otra.",
    en: "There are already ten active keys. Revoke one before creating another.",
  },
  mcpScopeRead: { es: "Sólo lectura", en: "Read only" },
  mcpScopeFull: { es: "Lectura y escritura", en: "Read and write" },
  mcpScopeReadHint: {
    es: "Consulta tu operación y no cambia nada.",
    en: "Queries your operation and changes nothing.",
  },
  mcpScopeFullHint: {
    es: "Además puede activar automatizaciones y escribirle a un cliente. Lo irreversible sigue pidiendo confirmación.",
    en: "Can also turn on automations and message a customer. Irreversible actions still ask for confirmation.",
  },
  mcpActivity: { es: "Actividad", en: "Activity" },
  mcpKeyPlaceholder: { es: "TU_LLAVE", en: "YOUR_KEY" },
  mcpHowTitle: { es: "Configuración para pegar", en: "Configuration to paste" },
  mcpOauthNote: {
    es: "Los clientes que soportan OAuth no necesitan llave: basta con darles la dirección del servidor.",
    en: "Clients that support OAuth need no key: just give them the server address.",
  },
  mcpCopied: { es: "Copiado", en: "Copied" },
  phoneLabel: { es: "WhatsApp", en: "WhatsApp" },
  phoneHint: {
    es: "A este número te preguntamos lo que la IA no decide sola, como un pago informado que no cierra.",
    en: "We message this number when the AI can't decide on its own — like a reported payment that doesn't add up.",
  },
  phoneInvalid: {
    es: "Ese número no parece válido. Incluye el código de país.",
    en: "That number doesn't look valid. Include the country code.",
  },
  emailChangePendingNotice: {
    es: "Revisa la bandeja de {oldEmail} y {newEmail} — ambos deben confirmar antes de que el cambio tenga efecto.",
    en: "Check the inbox of {oldEmail} and {newEmail} — both must confirm before the change takes effect.",
  },
  accountData: { es: "Datos de la cuenta", en: "Account data" },
  roleLabel: { es: "Rol", en: "Role" },
  joinedOn: { es: "Registrado el", en: "Joined on" },
  userId: { es: "ID de usuario", en: "User ID" },

  // Shopify card
  shopifyConnected: { es: "Shopify conectado", en: "Shopify connected" },
  shopifyConnectError: {
    es: "No se pudo conectar Shopify ({reason})",
    en: "Couldn't connect Shopify ({reason})",
  },
  shopifyMissingDomain: {
    es: "Falta el dominio de la tienda.",
    en: "Store domain is missing.",
  },
  shopifyDisconnectConfirm: {
    es: "¿Desconectar Shopify?",
    en: "Disconnect Shopify?",
  },
  shopifyDisconnected: { es: "Shopify desconectado", en: "Shopify disconnected" },
  shopifyDescription: {
    es: "Disparadores de carrito abandonado y pedidos hacia WhatsApp.",
    en: "Abandoned cart and order triggers to WhatsApp.",
  },
  shopifyMissingCredentials: {
    es: "Faltan credenciales SHOPIFY_API_KEY / SHOPIFY_API_SECRET en el servidor.",
    en: "Missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET credentials on the server.",
  },
  disconnect: { es: "Desconectar", en: "Disconnect" },
  shopifyDomainPlaceholder: {
    es: "tu-tienda.myshopify.com",
    en: "your-store.myshopify.com",
  },
  addAnotherStore: { es: "Añadir otra tienda", en: "Add another store" },
  missingCredentials: { es: "Faltan credenciales", en: "Missing credentials" },
  shopifyConnectToken: {
    es: "Conectar con token (custom app)",
    en: "Connect with token (custom app)",
  },
  shopifyUseTokenLink: {
    es: "o usar token de custom app",
    en: "or use a custom-app token",
  },
  shopifyTokenGuide: {
    es: "En tu Shopify Admin → Configuración → Apps → Desarrollar apps: crea una app con permisos de lectura/escritura de pedidos, clientes y productos, instálala y copia el Admin API access token + la API secret key.",
    en: "In your Shopify Admin → Settings → Apps → Develop apps: create an app with read/write access to orders, customers and products, install it, and copy the Admin API access token + the API secret key.",
  },
  shopifyTokenAccessPlaceholder: {
    es: "Admin API access token (shpat_…)",
    en: "Admin API access token (shpat_…)",
  },
  shopifyTokenSecretPlaceholder: {
    es: "API secret key",
    en: "API secret key",
  },
  shopifyTokenMissingFields: {
    es: "Completa el dominio, el token y la API secret key.",
    en: "Fill in the domain, token and API secret key.",
  },
  shopifyConnectedViaToken: { es: "vía custom app", en: "via custom app" },
  shopifyStoreClaimed: {
    es: "Tienda {shop} conectada",
    en: "Store {shop} connected",
  },
  storeClaimed: {
    es: "Tienda {shop} conectada",
    en: "Store {shop} connected",
  },

  // Tiendanube card
  tiendanubeDescription: {
    es: "Carritos abandonados y pedidos hacia WhatsApp.",
    en: "Abandoned carts and orders to WhatsApp.",
  },
  tiendanubeConnected: { es: "Tiendanube conectada", en: "Tiendanube connected" },
  tiendanubeDisconnected: {
    es: "Tiendanube desconectada",
    en: "Tiendanube disconnected",
  },
  tiendanubeDisconnectConfirm: {
    es: "¿Desconectar Tiendanube?",
    en: "Disconnect Tiendanube?",
  },
  tiendanubeConnectError: {
    es: "No se pudo conectar Tiendanube ({reason})",
    en: "Couldn't connect Tiendanube ({reason})",
  },

  // WooCommerce card
  woocommerceDescription: {
    es: "Carritos abandonados y pedidos hacia WhatsApp.",
    en: "Abandoned carts and orders to WhatsApp.",
  },
  woocommerceConnected: {
    es: "WooCommerce conectado",
    en: "WooCommerce connected",
  },
  woocommerceDisconnected: {
    es: "WooCommerce desconectado",
    en: "WooCommerce disconnected",
  },
  woocommerceDisconnectConfirm: {
    es: "¿Desconectar WooCommerce?",
    en: "Disconnect WooCommerce?",
  },
  woocommerceConnectError: {
    es: "No se pudo conectar WooCommerce ({reason})",
    en: "Couldn't connect WooCommerce ({reason})",
  },
  woocommerceSitePlaceholder: {
    es: "mitienda.com",
    en: "mystore.com",
  },
  woocommerceUseKeysLink: {
    es: "o pegar claves de API",
    en: "or paste API keys",
  },
  woocommerceKeysGuide: {
    es: "En WooCommerce → Ajustes → Avanzado → API REST: crea una clave con permiso de lectura/escritura y copia la clave y el secreto.",
    en: "In WooCommerce → Settings → Advanced → REST API: create a key with read/write permission and copy the key and secret.",
  },
  woocommerceKeyPlaceholder: {
    es: "Clave de cliente (ck_…)",
    en: "Consumer key (ck_…)",
  },
  woocommerceSecretPlaceholder: {
    es: "Secreto de cliente (cs_…)",
    en: "Consumer secret (cs_…)",
  },
  woocommerceKeysMissingFields: {
    es: "Completa la dirección, la clave y el secreto.",
    en: "Fill in the address, key and secret.",
  },
  // Qué hacer después de conectar WooCommerce
  wooDialogAfterTitle: {
    es: "Tienda conectada",
    en: "Store connected",
  },
  wooDialogAfterIntro: {
    es: "Falta un paso para recuperar carritos abandonados: WooCommerce no los registra por su cuenta.",
    en: "One step left to recover abandoned carts: WooCommerce doesn't track them on its own.",
  },
  wooDialogInstall1: {
    es: "Descarga el plugin (viene con tus datos ya cargados).",
    en: "Download the plugin (it comes preconfigured).",
  },
  wooDialogInstall2: {
    es: "En tu WordPress: Plugins → Añadir nuevo → Subir plugin.",
    en: "In your WordPress: Plugins → Add new → Upload plugin.",
  },
  wooDialogInstall3: {
    es: "Actívalo. Listo, no hay nada más que configurar.",
    en: "Activate it. Done, nothing else to configure.",
  },
  wooDialogLater: {
    es: "Más tarde",
    en: "Later",
  },
  woocommerceCartPlugin: {
    es: "Recuperar carritos",
    en: "Recover carts",
  },
  woocommerceCartPluginHint: {
    es: "Recupera también los carritos que se abandonan antes de enviar el pedido.",
    en: "Also recover carts abandoned before the order is placed.",
  },
  woocommerceDownloadPlugin: {
    es: "Descargar plugin",
    en: "Download plugin",
  },
  woocommercePluginReady: {
    es: "El plugin viene con tus datos ya cargados: instálalo y actívalo.",
    en: "The plugin comes preconfigured: just install and activate it.",
  },
  woocommercePluginError: {
    es: "No se pudo preparar el plugin.",
    en: "Couldn't prepare the plugin.",
  },

  // Común a las tarjetas de tienda
  storeSyncCatalog: { es: "Sincronizar catálogo", en: "Sync catalog" },
  storeCatalogSynced: {
    es: "{count} productos sincronizados",
    en: "{count} products synced",
  },
  storeSyncError: {
    es: "No se pudo sincronizar el catálogo.",
    en: "Couldn't sync the catalog.",
  },

  // Shopify embedded admin surface (App Bridge page inside Shopify admin)
  shopifyEmbeddedConnected: {
    es: "Tienda conectada a Riverz",
    en: "Store connected to Riverz",
  },
  shopifyEmbeddedPending: {
    es: "Falta vincular tu cuenta Riverz",
    en: "Riverz account not linked yet",
  },
  shopifyEmbeddedOpen: { es: "Abrir Riverz", en: "Open Riverz" },
  shopifyEmbeddedFinish: {
    es: "Completar instalación",
    en: "Complete installation",
  },
  shopifyEmbeddedError: {
    es: "No se pudo verificar la sesión de Shopify.",
    en: "Couldn't verify the Shopify session.",
  },

  // WhatsApp embedded signup
  whatsappAccountNotReceived: {
    es: "No se recibió la cuenta de WhatsApp.",
    en: "WhatsApp account wasn't received.",
  },
  whatsappConnectError: {
    es: "No se pudo conectar WhatsApp",
    en: "Couldn't connect WhatsApp",
  },
  whatsappConnectedCoexistence: {
    es: "WhatsApp conectado en coexistencia: {label}",
    en: "WhatsApp connected in coexistence: {label}",
  },
  whatsappConnectedLabel: {
    es: "WhatsApp conectado: {label}",
    en: "WhatsApp connected: {label}",
  },
  whatsappConnectedInReview: {
    es: "WhatsApp conectado. Ya puedes enviar y recibir; Meta está revisando tu negocio en segundo plano (hasta 24 h).",
    en: "WhatsApp connected. You can already send and receive; Meta is reviewing your business in the background (up to 24 h).",
  },
  whatsappConnectedCannotSend: {
    es: "WhatsApp conectado: ya recibes mensajes, pero Meta aún no habilita el envío. Revisa el estado de la cuenta en WhatsApp Manager.",
    en: "WhatsApp connected: you can already receive messages, but Meta hasn't enabled sending yet. Check the account status in WhatsApp Manager.",
  },
  whatsappOnboardingCancelled: {
    es: "Onboarding cancelado",
    en: "Onboarding cancelled",
  },
  connectWhatsappOfficial: {
    es: "Conectar WhatsApp (oficial)",
    en: "Connect WhatsApp (official)",
  },
  connectWhatsapp: {
    es: "Conectar WhatsApp",
    en: "Connect WhatsApp",
  },
  whatsappCoexistenceHint: {
    es: "Número nuevo o sigue usando tu WhatsApp Business del teléfono con el mismo número.",
    en: "A new number, or keep using your phone's WhatsApp Business with the same number.",
  },

  // Workspace panel
  workspaceDeleteError: {
    es: "No se pudo eliminar el espacio de trabajo",
    en: "Couldn't delete the workspace",
  },
  workspaceDeleted: {
    es: "Espacio de trabajo eliminado",
    en: "Workspace deleted",
  },
  workspaceRenamed: {
    es: "Espacio de trabajo renombrado",
    en: "Workspace renamed",
  },
  timezoneUpdated: { es: "Zona horaria actualizada", en: "Timezone updated" },
  inviteError: {
    es: "No se pudo enviar la invitación",
    en: "Couldn't send the invitation",
  },
  inviteSent: {
    es: "Invitación enviada a {email}",
    en: "Invitation sent to {email}",
  },
  inviteLinkCopied: {
    es: "Invitación creada. Enlace copiado: envíaselo tú.",
    en: "Invitation created. Link copied — send it yourself.",
  },
  memberRemoved: { es: "Miembro eliminado", en: "Member removed" },
  noWorkspace: {
    es: "Sin espacio de trabajo. Vuelve a iniciar sesión.",
    en: "No workspace. Sign in again.",
  },
  workspace: { es: "Espacio de trabajo", en: "Workspace" },
  nameLabel: { es: "Nombre", en: "Name" },
  timezoneLabel: { es: "Zona horaria", en: "Timezone" },
  timezoneHint: {
    es: "Rige el día de todas las métricas y las horas que se muestran en la bandeja, para todo el equipo.",
    en: "Governs the day for all metrics and the hours shown in the inbox, for the whole team.",
  },
  teamMembers: { es: "Miembros del equipo", en: "Team members" },
  memberPending: { es: "Pendiente", en: "Pending" },
  memberYou: { es: "(tú)", en: "(you)" },
  roleAdmin: { es: "Administrador", en: "Admin" },
  roleAgent: { es: "Usuario", en: "User" },
  removeMember: { es: "Eliminar miembro", en: "Remove member" },

  // Per-member menu access (RBAC)
  menuAccess: { es: "Acceso al menú", en: "Menu access" },
  menuAccessFull: { es: "Acceso completo", en: "Full access" },

  menuAccessHint: {
    es: "Elige a qué secciones del menú puede entrar.",
    en: "Choose which menu sections they can open.",
  },
  accessUpdated: { es: "Acceso actualizado", en: "Access updated" },
  invite: { es: "Invitar", en: "Invite" },
  invitePlaceholder: {
    es: "compañero@email.com",
    en: "teammate@email.com",
  },
  send: { es: "Enviar", en: "Send" },
  inviteAccessTitle: {
    es: "Acceso de {email}",
    en: "Access for {email}",
  },
  pendingInvites: {
    es: "Invitaciones pendientes",
    en: "Pending invitations",
  },
  inviteRoleExpires: {
    es: "Rol: {role} · expira el {date}",
    en: "Role: {role} · expires on {date}",
  },
  revokeInvite: { es: "Revocar invitación", en: "Revoke invitation" },
  deleteWorkspacePermanently: {
    es: "Eliminar workspace permanentemente",
    en: "Delete workspace permanently",
  },
  deleteWorkspaceWarning: {
    es: "El espacio se ocultará de inmediato para todo el equipo. La depuración real de datos personales corre como un proceso aparte.",
    en: "The workspace will be hidden immediately for the whole team. Actual deletion of personal data runs as a separate process.",
  },
  deleteWorkspaceConfirmPlaceholder: {
    es: 'Escribe "{name}" para confirmar',
    en: 'Type "{name}" to confirm',
  },
  deleteWorkspace: { es: "Eliminar workspace", en: "Delete workspace" },

  // Channels panel — card descriptions
  whatsappCardDescription: {
    es: "Cloud API, WhatsApp Business o coexistencia.",
    en: "Cloud API, WhatsApp Business or coexistence.",
  },
  metaCardDescription: {
    es: "Messenger y comentarios de tu página en una sola conexión.",
    en: "Messenger and your page's comments in a single connection.",
  },
  instagramCardDescription: {
    es: "DMs y comentarios de Instagram en una sola conexión.",
    en: "Instagram DMs and comments in a single connection.",
  },
  gmailCardDescription: {
    es: "Cuentas @gmail o Google Workspace.",
    en: "@gmail or Google Workspace accounts.",
  },
  outlookCardDescription: {
    es: "Bandeja para Outlook, Hotmail y Microsoft 365.",
    en: "Inbox for Outlook, Hotmail and Microsoft 365.",
  },
  mercadolibreCardDescription: {
    es: "Preguntas de tus publicaciones y mensajes post-venta.",
    en: "Questions on your listings and post-sale messages.",
  },
  tiktokCardDescription: {
    es: "Comentarios de tus videos de TikTok.",
    en: "Comments on your TikTok videos.",
  },
  tiktokBusinessNote: {
    es: "Requiere cuenta Business (cámbiala gratis en Ajustes de TikTok).",
    en: "Requires a Business account (switch for free in TikTok Settings).",
  },

  // Channels panel — clipboard + toasts
  copiedToClipboard: { es: "{label} copiado", en: "{label} copied" },
  couldNotCopy: { es: "No se pudo copiar", en: "Couldn't copy" },
  disconnectChannelConfirm: {
    es: "¿Desconectar este canal?",
    en: "Disconnect this channel?",
  },
  channelDisconnected: { es: "Canal desconectado", en: "Channel disconnected" },

  // Channels panel — empty / read-only states
  workspaceNotFound: {
    es: "No se encontró tu espacio de trabajo.",
    en: "Your workspace wasn't found.",
  },
  readOnly: { es: "Solo lectura.", en: "Read only." },

  // Channels panel — OAuth providers banner
  oauthAppsMissing: {
    es: "Faltan apps OAuth por registrar",
    en: "OAuth apps still need to be registered",
  },
  redirectUrisToPaste: {
    es: "Redirect URIs a pegar en cada consola:",
    en: "Redirect URIs to paste in each console:",
  },
  copy: { es: "Copiar", en: "Copy" },

  // Channels panel — header
  channels: { es: "Canales", en: "Channels" },
  channelActive: { es: "canal activo", en: "active channel" },
  channelsActive: { es: "canales activos", en: "active channels" },

  // Channels panel — connection rows
  noLabel: { es: "Sin etiqueta", en: "No label" },
  disconnectAction: { es: "Desconectar", en: "Disconnect" },
  deleteAction: { es: "Eliminar", en: "Delete" },
  configurePaymentMethod: {
    es: "Configurar medio de pago",
    en: "Set up payment method",
  },
  whatsappManagerPaymentTooltip: {
    es: "WhatsApp Manager → Configuración → Métodos de pago",
    en: "WhatsApp Manager → Settings → Payment methods",
  },

  // Channels panel — estado de entrega de WhatsApp
  healthAvailable: { es: "Envío disponible", en: "Sending available" },
  healthLimited: { es: "Envío limitado", en: "Sending limited" },
  healthBlocked: { es: "Envío bloqueado", en: "Sending blocked" },
  healthTier: { es: "Cupo: {tier}/24 h", en: "Limit: {tier}/24 h" },
  healthQuality: { es: "Calidad", en: "Quality" },
  healthVerifyNote: {
    es: "Verificar el negocio sube el cupo. No destraba la entrega a números fríos.",
    en: "Verifying the business raises your limit. It doesn't unblock delivery to cold numbers.",
  },
  verifyBusiness: { es: "Verificar negocio", en: "Verify business" },

  // Channels panel — CTAs
  oneWhatsappPerAccount: {
    es: "Un WhatsApp por cuenta. Desconéctalo para cambiar de número.",
    en: "One WhatsApp per account. Disconnect it to switch numbers.",
  },
  orConnectPastingToken: {
    es: "o conectar pegando un token manualmente",
    en: "or connect by pasting a token manually",
  },
  configureProvider: { es: "Configura el proveedor", en: "Set up the provider" },
  comingSoon: { es: "Próximamente", en: "Coming soon" },
  mlCountryLabel: { es: "País", en: "Country" },
  mlCountryPlaceholder: { es: "Elige tu país", en: "Choose your country" },
  mlChooseCountryFirst: {
    es: "Elige tu país antes de conectar.",
    en: "Choose your country before connecting.",
  },
  mlOpening: { es: "Abriendo Mercado Libre…", en: "Opening Mercado Libre…" },
  mlCancelAdd: { es: "Cancelar", en: "Cancel" },
  connect: { es: "Conectar", en: "Connect" },
  configureGoogleFirst: {
    es: "Configura Google Cloud OAuth Client primero (ver banner amarillo)",
    en: "Set up the Google Cloud OAuth Client first (see the yellow banner)",
  },
  configureMicrosoftFirst: {
    es: "Configura Microsoft Azure App primero (ver banner amarillo)",
    en: "Set up the Microsoft Azure App first (see the yellow banner)",
  },
  configureMetaFirst: {
    es: "Configura la Meta App primero (ver banner amarillo)",
    en: "Set up the Meta App first (see the yellow banner)",
  },
  disconnectAllAccountsConfirm: {
    es: "¿Desconectar las {n} cuentas de {label}?",
    en: "Disconnect the {n} {label} accounts?",
  },
  disconnectAll: { es: "Desconectar todas", en: "Disconnect all" },
  disconnectAllN: {
    es: "Desconectar las {n} cuentas",
    en: "Disconnect all {n} accounts",
  },

  // Channels panel — manual token modal
  manualLabelWhatsapp: { es: "WhatsApp", en: "WhatsApp" },
  manualLabelMessenger: { es: "Facebook Messenger", en: "Facebook Messenger" },
  manualLabelInstagram: { es: "Instagram DMs", en: "Instagram DMs" },
  manualLabelFbComment: { es: "Comentarios FB", en: "FB comments" },
  manualLabelIgComment: { es: "Comentarios IG", en: "IG comments" },
  manualTipWhatsapp: {
    es: "Pega un System User Token (whatsapp_business_messaging + whatsapp_business_management), el phone_number_id y el waba_id. El número debe estar registrado en Cloud API y no en uso en la app de WhatsApp Business del celular.",
    en: "Paste a System User Token (whatsapp_business_messaging + whatsapp_business_management), the phone_number_id and the waba_id. The number must be registered in Cloud API and not in use in the WhatsApp Business phone app.",
  },
  manualTipMessenger: {
    es: "Pega un Page Access Token de la página (Business Settings → System Users → Generar identificador con permiso pages_messaging + pages_show_list).",
    en: "Paste the page's Page Access Token (Business Settings → System Users → Generate token with the pages_messaging + pages_show_list permissions).",
  },
  manualTipInstagram: {
    es: "Pega el Page Access Token de la página que tiene la cuenta IG Profesional vinculada. Necesita permisos instagram_basic + instagram_manage_messages.",
    en: "Paste the Page Access Token of the page linked to the IG Professional account. It needs the instagram_basic + instagram_manage_messages permissions.",
  },
  manualTipFbComment: {
    es: "Pega el Page Access Token con permisos pages_read_engagement + pages_manage_engagement.",
    en: "Paste the Page Access Token with the pages_read_engagement + pages_manage_engagement permissions.",
  },
  manualTipIgComment: {
    es: "Pega el Page Access Token de la página que gestiona la cuenta IG con instagram_manage_comments.",
    en: "Paste the Page Access Token of the page managing the IG account with instagram_manage_comments.",
  },
  pasteAToken: { es: "Pega un token", en: "Paste a token" },
  whatsappNeedsIds: {
    es: "WhatsApp necesita phone_number_id y waba_id",
    en: "WhatsApp needs phone_number_id and waba_id",
  },
  couldNotSaveToken: {
    es: "No se pudo guardar el token",
    en: "Couldn't save the token",
  },
  connectedLabel: { es: "Conectado: {label}", en: "Connected: {label}" },
  connectWithToken: {
    es: "Conectar {label} con token",
    en: "Connect {label} with a token",
  },
  close: { es: "Cerrar", en: "Close" },
  cancel: { es: "Cancelar", en: "Cancel" },
  saveAndConnect: { es: "Guardar y conectar", en: "Save and connect" },

  // Assignment rules — kind labels
  ruleKindRoundRobin: { es: "Round robin", en: "Round robin" },
  ruleKindByTag: { es: "Por etiqueta", en: "By tag" },
  ruleKindByChannel: { es: "Por canal", en: "By channel" },
  ruleKindByKeyword: { es: "Por palabra clave", en: "By keyword" },

  // Assignment rules — kind hints
  ruleHintRoundRobin: {
    es: "Rota la conversación entre los agentes seleccionados.",
    en: "Rotates the conversation among the selected agents.",
  },
  ruleHintByTag: {
    es: "Asigna al agente si el contacto tiene la etiqueta.",
    en: "Assigns the agent if the contact has the tag.",
  },
  ruleHintByChannel: {
    es: "Asigna al agente cuando la conversación viene del canal.",
    en: "Assigns the agent when the conversation comes from the channel.",
  },
  ruleHintByKeyword: {
    es: "Asigna al agente si el primer mensaje contiene la palabra.",
    en: "Assigns the agent if the first message contains the word.",
  },

  // Assignment rules — toasts
  rulesLoadError: { es: "No se cargaron las reglas", en: "Couldn't load the rules" },
  workspaceUnavailable: {
    es: "Workspace no disponible",
    en: "Workspace unavailable",
  },
  couldNotUpdate: { es: "No se pudo actualizar", en: "Couldn't update" },
  deleteRuleConfirm: { es: "¿Eliminar regla?", en: "Delete rule?" },
  couldNotDelete: { es: "No se pudo eliminar", en: "Couldn't delete" },
  ruleDeleted: { es: "Regla eliminada", en: "Rule deleted" },
  giveItAName: { es: "Ponle un nombre", en: "Give it a name" },
  couldNotSave: { es: "No se pudo guardar", en: "Couldn't save" },
  ruleUpdated: { es: "Regla actualizada", en: "Rule updated" },
  ruleCreated: { es: "Regla creada", en: "Rule created" },

  // Assignment rules — headings + descriptions
  assignmentRules: { es: "Reglas de asignación", en: "Assignment rules" },
  newRule: { es: "Nueva regla", en: "New rule" },
  noRulesYet: { es: "Sin reglas todavía", en: "No rules yet" },
  createFirstRule: { es: "Crear primera regla", en: "Create first rule" },

  // Assignment rules — row card
  anyChannel: { es: "Cualquier canal", en: "Any channel" },
  rulePriorityChannel: {
    es: "Prioridad {priority} · {channel}",
    en: "Priority {priority} · {channel}",
  },
  pauseRule: { es: "Pausar regla", en: "Pause rule" },
  activateRule: { es: "Activar regla", en: "Activate rule" },
  edit: { es: "Editar", en: "Edit" },

  // Assignment rules — editor modal
  anyOption: { es: "Cualquiera", en: "Any" },
  editRule: { es: "Editar regla", en: "Edit rule" },
  ruleNameLabel: { es: "Nombre", en: "Name" },
  ruleNamePlaceholder: {
    es: "Ej: Repartir a soporte",
    en: "E.g. Route to support",
  },
  ruleTypeLabel: { es: "Tipo", en: "Type" },
  ruleChannelLabel: { es: "Canal", en: "Channel" },
  ruleChannelHint: {
    es: "La regla solo aplica a conversaciones de este canal.",
    en: "The rule only applies to conversations from this channel.",
  },
  rulePriorityLabel: { es: "Prioridad", en: "Priority" },
  ruleActiveLabel: { es: "Activa", en: "Active" },
  agentIdsLabel: {
    es: "IDs de agentes (separados por coma)",
    en: "Agent IDs (comma-separated)",
  },
  tagIdLabel: { es: "ID de etiqueta", en: "Tag ID" },
  agentIdLabel: { es: "ID de agente", en: "Agent ID" },
  keywordLabel: { es: "Palabra clave", en: "Keyword" },
  targetChannelLabel: { es: "Canal objetivo", en: "Target channel" },
  selectPlaceholder: { es: "Selecciona", en: "Select" },
  save: { es: "Guardar", en: "Save" },

  // ── Comentario a DM (auto-DM on comments, migration 086) ──
  tabCommentToDm: { es: "Comentario a DM", en: "Comment to DM" },
  c2dmNew: { es: "Nueva regla", en: "New rule" },
  c2dmIgComment: { es: "Comentarios de Instagram", en: "Instagram comments" },
  c2dmFbComment: { es: "Comentarios de Facebook", en: "Facebook comments" },
  // Una regla que escucha las dos redes (migración 203): antes había que
  // escribirla dos veces y editarla dos veces cada vez que cambiaba el texto.
  c2dmBothComments: {
    es: "Comentarios de Instagram y Facebook",
    en: "Instagram and Facebook comments",
  },
  c2dmTtComment: { es: "Comentarios de TikTok", en: "TikTok comments" },
  c2dmKeywordsLabel: { es: "Palabras clave", en: "Keywords" },
  c2dmKeywordsHint: {
    es: "Separadas por coma. Vacío: cualquier comentario.",
    en: "Comma-separated. Empty: any comment.",
  },
  c2dmKeywordsPlaceholder: { es: "precio, info, quiero", en: "price, info, want" },
  c2dmKeywordsAny: { es: "cualquier comentario", en: "any comment" },
  c2dmDmMessageLabel: { es: "Mensaje del DM", en: "DM message" },
  c2dmDmMessagePlaceholder: {
    es: "¡Hola! Gracias por comentar 🙌 Te paso la info por aquí…",
    en: "Hi! Thanks for commenting 🙌 Here's the info you asked for…",
  },
  c2dmDmMessageRequired: {
    es: "Escribe el mensaje del DM",
    en: "Write the DM message",
  },
  c2dmAttachmentLabel: { es: "Recurso (opcional)", en: "Resource (optional)" },
  c2dmAttachmentHint: {
    es: "Imagen, video o PDF: llega adjunto en el DM.",
    en: "Image, video or PDF: it arrives attached in the DM.",
  },
  c2dmButtonLabelLabel: { es: "Texto del enlace (opcional)", en: "Link text (optional)" },
  c2dmButtonUrlLabel: { es: "Enlace (opcional)", en: "Link URL (optional)" },
  c2dmDmSentCount: { es: "{count} DM enviados", en: "{count} DMs sent" },
  // Sólo aparece si los hay: una regla que dispara y nunca entrega se leía
  // igual que una que nadie activó.
  c2dmDmFailedCount: { es: "{count} sin entregar", en: "{count} undelivered" },
  c2dmCreated: { es: "Regla creada", en: "Rule created" },
  c2dmUpdated: { es: "Regla actualizada", en: "Rule updated" },

  // ── Reglas: lista + editor rediseñados ──
  c2dmRulesTitle: { es: "Reglas", en: "Rules" },
  c2dmRulesHint: {
    es: "Tus palabras exactas. Una regla manda sobre la IA.",
    en: "Your exact words. A rule wins over the AI.",
  },
  c2dmEmpty: { es: "Sin reglas.", en: "No rules." },
  c2dmActionReplyAndDm: { es: "responde y manda DM", en: "public reply + DM" },
  c2dmActionDmOnly: { es: "manda DM", en: "DM only" },
  // TikTok no tiene privado: la regla sólo puede publicar bajo el video.
  c2dmActionReplyOnly: { es: "responde en el video", en: "replies on the video" },
  c2dmOnePostOnly: { es: "un solo post", en: "one post only" },
  c2dmPostLabel: { es: "Post", en: "Post" },
  c2dmPostPlaceholder: { es: "Todos los posts", en: "All posts" },
  c2dmSectionWhen: { es: "Cuándo", en: "When" },
  c2dmSectionWhat: { es: "Qué mandas", en: "What you send" },
  c2dmPublicRepliesLabel: {
    es: "Respuesta pública (opcional)",
    en: "Public reply (optional)",
  },
  // En TikTok es lo único que la regla puede hacer, así que deja de ser opcional.
  c2dmPublicRepliesRequiredLabel: {
    es: "Respuesta pública",
    en: "Public reply",
  },
  c2dmPublicReplyRequired: {
    es: "Escribe la respuesta que se publica",
    en: "Write the reply that gets posted",
  },
  c2dmPublicRepliesHint: {
    es: "Una por línea; rotamos al azar.",
    en: "One per line; we rotate at random.",
  },
  c2dmRuleOptions: { es: "Opciones de la regla", en: "Rule options" },
  c2dmPreview: { es: "Así se ve", en: "How it looks" },
  c2dmPreviewPublic: { es: "En el comentario", en: "On the comment" },
  c2dmPreviewDm: { es: "En el DM", en: "In the DM" },

  tabBilling: { es: "Plan", en: "Plan" },

  // El permiso para que soporte lea las conversaciones. Lo abre el comercio.
  supportTitle: { es: "Ayuda de soporte", en: "Support access" },
  supportClosed: {
    es: "Riverz no puede leer tus conversaciones. Si necesitas que revisemos una, abre el acceso por un rato.",
    en: "Riverz cannot read your conversations. If you need us to look at one, open access for a while.",
  },
  supportOpenUntil: {
    es: "Soporte puede leer tus conversaciones hasta el {fecha}.",
    en: "Support can read your conversations until {fecha}.",
  },
  supportHours: { es: "{n} horas", en: "{n} hours" },
  supportDays: { es: "{n} días", en: "{n} days" },
  supportRevoke: { es: "Cerrar el acceso", en: "Close access" },
  supportError: { es: "No se pudo cambiar.", en: "Could not change it." },

  // Facturación, en Ajustes.
  billingTitle: { es: "Plan y facturación", en: "Plan and billing" },
  billingTrial: {
    es: "Te quedan {n} días de prueba.",
    en: "{n} days of trial left.",
  },
  billingTrialLast: {
    es: "Hoy es el último día de prueba.",
    en: "Today is the last day of your trial.",
  },
  billingExpired: {
    es: "La prueba terminó. Pon una tarjeta para seguir.",
    en: "Your trial ended. Add a card to continue.",
  },
  billingComped: {
    es: "Tu cuenta está sin cargo.",
    en: "Your account is free of charge.",
  },
  billingActive: { es: "Suscripción activa.", en: "Subscription active." },
  billingPastDue: {
    es: "No pudimos cobrar. Revisa la tarjeta.",
    en: "We could not charge you. Check your card.",
  },
  billingCanceled: {
    es: "La suscripción está cancelada.",
    en: "Your subscription is canceled.",
  },
  billingCancelAtEnd: {
    es: "Se cancela al final del período.",
    en: "It cancels at the end of the period.",
  },
  billingThisPeriod: { es: "Este período", en: "This period" },
  billingConversations: {
    es: "{n} de {total} conversaciones",
    en: "{n} of {total} conversations",
  },
  billingOver: {
    es: "{n} por encima del cupo",
    en: "{n} over the quota",
  },
  billingTotal: { es: "Total", en: "Total" },
  billingSubscribe: { es: "Poner tarjeta", en: "Add a card" },
  billingManage: { es: "Administrar", en: "Manage" },
  billingPerMonth: { es: "Por mes", en: "Per month" },
  billingRenewsOn: { es: "Se renueva el", en: "Renews on" },
  billingEndsOn: { es: "Termina el", en: "Ends on" },
  billingCancel: { es: "Cancelar suscripción", en: "Cancel subscription" },
  billingCancelConfirm: {
    es: "Se cancela al final del período ya pagado. Hasta entonces todo sigue funcionando.",
    en: "It cancels at the end of the period you already paid. Everything keeps working until then.",
  },
  billingResume: { es: "Reanudar suscripción", en: "Resume subscription" },

  // ── Billetera ──
  tabWallet: { es: "Saldo", en: "Balance" },
  walletBalance: { es: "Saldo disponible", en: "Available balance" },
  walletTopUp: { es: "Recarga", en: "Top-up" },
  walletTopUpFailed: {
    es: "No se pudo abrir la recarga.",
    en: "Couldn't open the top-up.",
  },
  walletOther: { es: "Otro", en: "Other" },
  walletMin: { es: "Mínimo US$5", en: "Minimum US$5" },
  walletEmpty: {
    es: "Te quedaste sin saldo. La cuenta sigue funcionando, pero conviene recargar.",
    en: "You're out of balance. The account still works, but it's worth topping up.",
  },
  walletEmptyBlocking: {
    es: "Te quedaste sin saldo y la IA dejó de responder. Recarga para reanudar.",
    en: "You're out of balance and the AI stopped replying. Top up to resume.",
  },
  walletToday: { es: "Hoy", en: "Today" },
  walletYesterday: { es: "Ayer", en: "Yesterday" },
  walletLastDays: { es: "{n} días", en: "{n} days" },
  walletSpent: { es: "Gastado", en: "Spent" },
  walletLoaded: { es: "Cargado", en: "Loaded" },
  walletByDay: { es: "Gasto por día", en: "Spend per day" },
  walletByConcept: { es: "En qué se fue", en: "Where it went" },
  walletNoSpend: {
    es: "Sin consumo en este rango.",
    en: "No usage in this range.",
  },
  walletLedger: { es: "Detalle", en: "Activity" },
  walletNoMovements: {
    es: "Sin movimientos en este rango.",
    en: "No movements in this range.",
  },
  walletClearFilter: { es: "Ver todo", en: "Show all" },
  walletPrev: { es: "Anterior", en: "Previous" },
  walletNext: { es: "Siguiente", en: "Next" },
  walletRates: { es: "Cuánto sale cada cosa", en: "What each thing costs" },
  walletYourAverage: { es: "tu promedio", en: "your average" },
  walletAtCostNote: {
    es: "Tu cuenta paga el costo real, sin margen: esto es exactamente lo que se te descuenta.",
    en: "Your account pays the real cost, with no margin: this is exactly what gets deducted.",
  },
  walletEstimate: { es: "estimado", en: "estimate" },
  walletNoCharge: { es: "Sin cargo", en: "No charge" },
  walletInsideOf: { es: "Dentro de «{linea}»", en: "Inside “{linea}”" },
  walletIncluded: {
    es: "Sin cargo: transcribir las notas de voz de tus clientes y el audio de tus videos.",
    en: "No charge: transcribing your customers' voice notes and your videos' audio.",
  },

  // ── Recarga automática ──
  walletAutoTitle: { es: "Recarga automática", en: "Auto top-up" },
  walletAutoOff: {
    es: "Guarda una tarjeta y el saldo se repone solo antes de que la IA se calle.",
    en: "Save a card and your balance refills itself before the AI goes quiet.",
  },
  walletAutoOn: {
    es: "Se cargan {monto} cuando el saldo baja de {umbral}.",
    en: "{monto} is charged whenever the balance drops below {umbral}.",
  },
  walletCardAdd: { es: "Agregar tarjeta", en: "Add card" },
  walletCardChange: { es: "Cambiar tarjeta", en: "Change card" },
  walletAutoAmount: { es: "Cargar (US$)", en: "Load (US$)" },
  walletAutoThreshold: { es: "Cuando baje de (US$)", en: "When it drops below (US$)" },
  walletAutoSave: { es: "Guardar", en: "Save" },
  walletAutoTurnOff: { es: "Apagar", en: "Turn off" },
  walletAutoSaved: { es: "Listo.", en: "Done." },
  walletAutoFailed: {
    es: "El último cobro automático no entró. Se vuelve a intentar.",
    en: "The last automatic charge didn't go through. It will retry.",
  },
  walletAutoGaveUp: {
    es: "El cobro automático falló tres veces y se detuvo. Cambia la tarjeta para reanudarlo.",
    en: "Auto top-up failed three times and stopped. Change the card to resume it.",
  },

  // ── Avisos de cobro ──
  avisoGracia: {
    es: "El último cobro falló. Tienes {n} horas para actualizar el pago antes de perder el acceso.",
    en: "The last charge failed. You have {n} hours to update your payment before losing access.",
  },
  avisoGraciaCta: { es: "Actualizar pago", en: "Update payment" },
  avisoSinSaldo: {
    es: "Te quedaste sin saldo: la IA dejó de responder. La bandeja sigue abierta para contestar a mano.",
    en: "You're out of balance: the AI stopped replying. The inbox is still open to answer manually.",
  },
  avisoSinSaldoCta: { es: "Recargar", en: "Top up" },
  impagoTitle: { es: "La cuenta está pausada", en: "Your account is paused" },
  impagoBody: {
    es: "El cobro de la suscripción no entró y pasaron las 48 horas. Pon una tarjeta y vuelve todo enseguida.",
    en: "The subscription payment didn't go through and the 48 hours are up. Add a card and everything comes back right away.",
  },
  impagoCta: { es: "Pagar ahora", en: "Pay now" },
  impagoError: {
    es: "No se pudo abrir el pago. Intenta de nuevo.",
    en: "Couldn't open the payment. Try again.",
  },
} satisfies Namespace;
