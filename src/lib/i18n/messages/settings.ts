import type { Namespace } from "./types";

/** Settings page: tabs, appearance and the language picker. */
export const settings = {
  title: { es: "Ajustes", en: "Settings" },
  integrations: { es: "Integraciones", en: "Integrations" },

  // Tabs
  tabProfile: { es: "Perfil", en: "Profile" },
  tabWorkspace: { es: "Equipo", en: "Team" },
  tabRules: { es: "Reglas", en: "Rules" },
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
  languageDescription: {
    es: "Elige el idioma de la interfaz. Tu elección se guarda para la próxima vez.",
    en: "Choose the interface language. Your choice is saved for next time.",
  },
  useLanguage: { es: "Usar {name}", en: "Use {name}" },

  // Settings page header
  backToSettings: { es: "Volver a Ajustes", en: "Back to Settings" },
  configuration: { es: "Configuración", en: "Configuration" },

  // Integrations page
  ownAudience: { es: "Audiencia propia", en: "Your audience" },

  // Klaviyo card
  klaviyoDescription: {
    es: "Sincroniza los leads que captura el Agente de Instagram a tu lista de email/SMS.",
    en: "Sync the leads captured by the Instagram Agent to your email/SMS list.",
  },
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
  klaviyoDisconnected: { es: "Klaviyo desconectado", en: "Klaviyo disconnected" },
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
  chooseAccountsDescription: {
    es: "Selecciona qué cuentas quieres conectar a este espacio de trabajo.",
    en: "Select which accounts you want to connect to this workspace.",
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
  emailChangePendingNotice: {
    es: "Revisa la bandeja de {oldEmail} y {newEmail} — ambos deben confirmar antes de que el cambio tenga efecto.",
    en: "Check the inbox of {oldEmail} and {newEmail} — both must confirm before the change takes effect.",
  },
  accountData: { es: "Datos de la cuenta", en: "Account data" },
  roleLabel: { es: "Rol", en: "Role" },
  joinedOn: { es: "Registrado el", en: "Joined on" },
  userId: { es: "ID de usuario", en: "User ID" },

  // Sessions card
  activeSessions: { es: "Sesiones activas", en: "Active sessions" },
  signOutAllDevices: {
    es: "Cerrar sesión en todos los dispositivos",
    en: "Sign out on all devices",
  },
  signOutAllConfirm: {
    es: "¿Cerrar sesión en todos los dispositivos?",
    en: "Sign out on all devices?",
  },
  signOut: { es: "Cerrar sesión", en: "Sign out" },

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
  whatsappOnboardingCancelled: {
    es: "Onboarding cancelado",
    en: "Onboarding cancelled",
  },
  connectWhatsappOfficial: {
    es: "Conectar WhatsApp (oficial)",
    en: "Connect WhatsApp (official)",
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
  roleAgent: { es: "Agente", en: "Agent" },
  removeMember: { es: "Eliminar miembro", en: "Remove member" },
  invite: { es: "Invitar", en: "Invite" },
  invitePlaceholder: {
    es: "compañero@email.com",
    en: "teammate@email.com",
  },
  send: { es: "Enviar", en: "Send" },
  monthlyUsage: { es: "Uso del mes", en: "Monthly usage" },
  messagesSent: { es: "Mensajes enviados", en: "Messages sent" },
  aiReplies: { es: "Respuestas de IA", en: "AI replies" },
  usageHint: {
    es: "Contadores del mes calendario actual, según la zona horaria del espacio de trabajo.",
    en: "Counters for the current calendar month, based on the workspace timezone.",
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
} satisfies Namespace;
