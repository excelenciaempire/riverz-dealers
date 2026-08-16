import type { Namespace } from "./types";

/**
 * Merchant-facing API error/success strings for account, auth, workspace,
 * invite, integration and waitlist route handlers. Returned as JSON
 * { error: "..." } / { message: "..." } and surfaced in dashboard toasts.
 */
export const errAccount = {
  // Login
  invalidCredentials: {
    es: "Email o contraseña incorrectos.",
    en: "Incorrect email or password.",
  },

  // Reset password
  resetEmailSent: {
    es: "Si la cuenta existe, recibirás un correo con instrucciones.",
    en: "If the account exists, you'll receive an email with instructions.",
  },

  // Signup
  signupGenericOk: {
    es: "Si el correo es válido, recibirás un mensaje.",
    en: "If the email is valid, you'll receive a message.",
  },
  signupsClosed: {
    es: "El registro está cerrado por ahora. Apúntate a la lista de espera en riverz.co.",
    en: "Sign-ups are closed for now. Join the waitlist at riverz.co.",
  },
  invitesClosed: {
    es: "Las invitaciones están desactivadas durante el prelanzamiento.",
    en: "Invitations are disabled during pre-launch.",
  },

  // Accept invite
  notSignedIn: {
    es: "No has iniciado sesión.",
    en: "You're not signed in.",
  },
  tokenRequired: {
    es: "Token requerido.",
    en: "Token required.",
  },
  inviteInvalid: {
    es: "Esta invitación no es válida.",
    en: "This invitation is not valid.",
  },
  inviteAlreadyUsed: {
    es: "Esta invitación ya fue usada.",
    en: "This invitation has already been used.",
  },
  inviteExpired: {
    es: "La invitación caducó. Pide una nueva al administrador.",
    en: "The invitation expired. Ask the admin for a new one.",
  },
  verifyEmailFirst: {
    es: "Verifica tu correo antes de aceptar la invitación. Revisa tu bandeja de entrada.",
    en: "Verify your email before accepting the invitation. Check your inbox.",
  },
  mustAcceptTerms: {
    es: "Debes aceptar los Términos y condiciones y la Política de privacidad para continuar.",
    en: "You must accept the Terms and Conditions and the Privacy Policy to continue.",
  },
  phoneInvalid: {
    es: "Escribe tu número de WhatsApp con código de país.",
    en: "Enter your WhatsApp number with its country code.",
  },
  invitedAddressFallback: {
    es: "la dirección invitada",
    en: "the invited address",
  },
  inviteForOtherAccount: {
    es: "Este enlace fue creado para otra cuenta. Inicia sesión con {masked} o pide una nueva invitación.",
    en: "This link was created for another account. Sign in with {masked} or request a new invitation.",
  },
  joinWorkspaceFailed: {
    es: "No se pudo unirte al espacio de trabajo.",
    en: "We couldn't add you to the workspace.",
  },

  // Create invite
  emailInvalid: {
    es: "Correo inválido",
    en: "Invalid email",
  },
  createInviteFailed: {
    es: "No se pudo crear la invitación",
    en: "We couldn't create the invitation",
  },
  unauthorized: {
    es: "No autorizado",
    en: "Unauthorized",
  },
  inviteFieldsRequired: {
    es: "workspace_id y correo requeridos",
    en: "workspace_id and email are required",
  },
  inviteAdminOnly: {
    es: "Acceso denegado: solo administradores",
    en: "Forbidden — admin only",
  },

  // Delete workspace
  deleteFieldsRequired: {
    es: "workspace_id y confirm_name requeridos",
    en: "workspace_id and confirm_name are required",
  },
  workspaceNotFound: {
    es: "Workspace no encontrado",
    en: "Workspace not found",
  },
  onlyOwnerCanDelete: {
    es: "Solo el dueño puede eliminar",
    en: "Only the owner can delete it",
  },
  nameMismatch: {
    es: "El nombre no coincide",
    en: "The name doesn't match",
  },
  deleteWorkspaceFailed: {
    es: "No se pudo eliminar el workspace",
    en: "We couldn't delete the workspace",
  },

  // Klaviyo integration
  notAuthenticated: {
    es: "No autenticado",
    en: "Not authenticated",
  },
  noWorkspace: {
    es: "Sin workspace",
    en: "No workspace",
  },
  apiKeyInvalid: {
    es: "API key inválida",
    en: "Invalid API key",
  },
  mpTokenInvalid: {
    es: "Mercado Pago rechazó ese token. Usa el Access Token de producción (empieza con APP_USR-).",
    en: "Mercado Pago rejected that token. Use the production Access Token (it starts with APP_USR-).",
  },
  // Note: waitlist's "Correo inválido" reuses `emailInvalid` above.
} satisfies Namespace;
