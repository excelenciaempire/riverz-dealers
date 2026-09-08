import type { Namespace } from "./types";

/** Auth flow: login, signup, password reset, email verification, invites. */
export const auth = {
  // Shared
  emailLabel: { es: "Correo electrónico", en: "Email" },
  emailPlaceholder: { es: "tu@correo.com", en: "you@email.com" },
  passwordLabel: { es: "Contraseña", en: "Password" },
  backToLogin: { es: "Volver al inicio de sesión", en: "Back to sign in" },
  checkYourEmail: { es: "Revisa tu correo", en: "Check your email" },
  tooManyAttempts: {
    es: "Demasiados intentos. Vuelve a probar en {retry} segundos.",
    en: "Too many attempts. Try again in {retry} seconds.",
  },

  // La tira oscura de las pantallas de acceso. Es lo primero que ve alguien
  // que todavía no decidió si nos va a confiar su WhatsApp, así que dice la
  // promesa y las credenciales — no una frase de marketing.
  frameTitle: {
    es: "Menos caos, más facturación",
    en: "Less chaos, more revenue",
  },
  trustOfficialApi: {
    es: "Por la API oficial de Meta",
    en: "Through the official Meta API",
  },
  trustReviewed: {
    es: "App Review de Meta aprobado",
    en: "Meta App Review approved",
  },
  trustYourNumber: {
    es: "Tu número queda a tu nombre",
    en: "Your number stays in your name",
  },

  // Login
  loginTitle: { es: "Iniciar sesión", en: "Sign in" },
  loginError: { es: "No se pudo iniciar sesión", en: "Could not sign in" },
  forgotPassword: { es: "¿Olvidaste tu contraseña?", en: "Forgot your password?" },
  signingIn: { es: "Iniciando sesión...", en: "Signing in..." },
  signIn: { es: "Iniciar sesión", en: "Sign in" },
  noAccount: { es: "¿No tienes cuenta?", en: "Don't have an account?" },
  createAccount: { es: "Crear cuenta", en: "Create account" },

  // Signup
  signupTitle: { es: "Crear cuenta", en: "Create account" },
  shopifyPendingNotice: {
    es: "Instalaste Riverz en {shop}. Crea tu cuenta para conectar tu tienda.",
    en: "You installed Riverz on {shop}. Create your account to connect your store.",
  },
  passwordsDontMatch: { es: "Las contraseñas no coinciden", en: "Passwords don't match" },
  passwordMin6: {
    es: "La contraseña debe tener al menos 6 caracteres",
    en: "Password must be at least 6 characters",
  },
  mustAcceptTerms: {
    es: "Debes aceptar los Términos y la Política de privacidad",
    en: "You must accept the Terms and Privacy Policy",
  },
  signupError: { es: "No se pudo crear la cuenta", en: "Could not create account" },
  signupInstructionsSent: {
    es: "Enviamos las instrucciones para continuar a",
    en: "We sent instructions to continue to",
  },
  existingAccountEmailSubject: {
    es: "Ya tienes una cuenta en Riverz",
    en: "You already have a Riverz account",
  },
  existingAccountEmailTitle: {
    es: "Tu cuenta ya existe",
    en: "Your account already exists",
  },
  existingAccountEmailBody: {
    es: "Este correo ya está registrado. Inicia sesión con tu contraseña actual.",
    en: "This email is already registered. Sign in with your current password.",
  },
  confirmationEmailSubject: {
    es: "Confirma tu cuenta de Riverz",
    en: "Confirm your Riverz account",
  },
  confirmationEmailTitle: {
    es: "Confirma tu correo",
    en: "Confirm your email",
  },
  confirmationEmailBody: {
    es: "Usa este enlace para activar tu cuenta.",
    en: "Use this link to activate your account.",
  },
  confirmationEmailButton: {
    es: "Confirmar correo",
    en: "Confirm email",
  },
  recoveryEmailSubject: {
    es: "Recupera tu cuenta de Riverz",
    en: "Recover your Riverz account",
  },
  recoveryEmailTitle: {
    es: "Recupera tu cuenta",
    en: "Recover your account",
  },
  recoveryEmailBody: {
    es: "Usa este enlace para crear una contraseña nueva.",
    en: "Use this link to create a new password.",
  },
  recoveryEmailButton: {
    es: "Crear contraseña nueva",
    en: "Create a new password",
  },
  authEmailFooter: {
    es: "Si no solicitaste este mensaje, puedes ignorarlo.",
    en: "If you didn't request this message, you can ignore it.",
  },
  fullNameLabel: { es: "Nombre completo", en: "Full name" },
  inviteEmailLocked: {
    es: "Esta invitación es para esta dirección. Tu cuenta debe usarla.",
    en: "This invitation is for this address. Your account must use it.",
  },
  confirmPasswordLabel: { es: "Confirmar contraseña", en: "Confirm password" },
  inviteCodeLabel: { es: "Código de invitación", en: "Invitation code" },
  inviteCodePlaceholder: { es: "RIVZ-8K3M", en: "RIVZ-8K3M" },
  inviteCodeHint: {
    es: "Te lo da el equipo de Riverz.",
    en: "The Riverz team gives you this.",
  },
  phoneLabel: { es: "WhatsApp", en: "WhatsApp" },
  phonePlaceholder: { es: "+57 300 000 0000", en: "+1 555 000 0000" },
  phoneHint: {
    es: "Te escribimos aquí cuando el asistente necesite tu decisión.",
    en: "We message you here when the assistant needs your decision.",
  },
  phoneInvalid: {
    es: "Escribe el número con código de país",
    en: "Enter the number with its country code",
  },
  showPassword: { es: "Mostrar contraseña", en: "Show password" },
  hidePassword: { es: "Ocultar contraseña", en: "Hide password" },
  acceptPrefix: { es: "Acepto los", en: "I accept the" },
  termsLink: { es: "Términos y condiciones", en: "Terms and Conditions" },
  acceptAnd: { es: "y la", en: "and the" },
  privacyLink: { es: "Política de privacidad", en: "Privacy Policy" },
  creatingAccount: { es: "Creando cuenta...", en: "Creating account..." },
  haveAccount: { es: "¿Ya tienes una cuenta?", en: "Already have an account?" },
  signInLink: { es: "Inicia sesión", en: "Sign in" },

  // Forgot password
  forgotTitle: { es: "Restablecer contraseña", en: "Reset password" },
  forgotError: { es: "No se pudo enviar el enlace", en: "Could not send the link" },
  resetLinkSent: {
    es: "Enviamos un enlace de restablecimiento a",
    en: "We sent a reset link to",
  },
  sending: { es: "Enviando...", en: "Sending..." },
  sendLink: { es: "Enviar enlace", en: "Send link" },

  // New password
  linkExpired: {
    es: "El enlace expiró o no es válido. Solicita uno nuevo.",
    en: "The link expired or is invalid. Request a new one.",
  },
  passwordMin8: {
    es: "La contraseña debe tener al menos 8 caracteres",
    en: "Password must be at least 8 characters",
  },
  passwordUpdated: { es: "Contraseña actualizada", en: "Password updated" },
  redirectingToDashboard: { es: "Te llevamos a tu panel.", en: "Taking you to your dashboard." },
  newPasswordTitle: { es: "Crear nueva contraseña", en: "Create a new password" },
  newPasswordLabel: { es: "Nueva contraseña", en: "New password" },
  saving: { es: "Guardando...", en: "Saving..." },
  savePassword: { es: "Guardar contraseña", en: "Save password" },

  // Verify email
  emailVerified: { es: "Correo verificado", en: "Email verified" },
  verifyEmailTitle: { es: "Verifica tu correo", en: "Verify your email" },
  verifyEmailDescription: {
    es: "Te enviamos un enlace de confirmación a",
    en: "We sent a confirmation link to",
  },
  yourEmailFallback: { es: "tu correo", en: "your email" },
  linkResent: {
    es: "Enlace reenviado. Revisa tu bandeja de entrada.",
    en: "Link resent. Check your inbox.",
  },
  resendLink: { es: "Reenviar enlace", en: "Resend link" },
  signOut: { es: "Cerrar sesión", en: "Sign out" },

  // Invite
  inviteInvalid: {
    es: "Esta invitación no es válida o ya fue usada.",
    en: "This invitation is invalid or has already been used.",
  },
  inviteAlreadyUsed: {
    es: "Esta invitación ya fue usada.",
    en: "This invitation has already been used.",
  },
  inviteExpired: {
    es: "La invitación caducó. Pídele al administrador que te envíe una nueva.",
    en: "The invitation expired. Ask the admin to send you a new one.",
  },
  yourTeamFallback: { es: "tu equipo", en: "your team" },
  acceptInviteError: {
    es: "No se pudo aceptar la invitación",
    en: "Could not accept the invitation",
  },
  inviteAccepted: { es: "Invitación aceptada", en: "Invitation accepted" },
  loadingInvite: { es: "Cargando invitación…", en: "Loading invitation…" },
  joinWorkspace: { es: "Unirte a “{name}”", en: "Join “{name}”" },
  inviteForPrefix: { es: "Invitación para", en: "Invitation for" },
  acceptInvite: { es: "Aceptar invitación", en: "Accept invitation" },
  inviteAcceptedTitle: { es: "¡Listo!", en: "All set!" },
  takingYouToInbox: { es: "Llevándote a la bandeja…", en: "Taking you to your inbox…" },
  inviteInvalidTitle: { es: "Invitación no válida", en: "Invalid invitation" },
  backToDashboard: { es: "Volver al panel", en: "Back to dashboard" },

  // Auth layout footer
  privacy: { es: "Privacidad", en: "Privacy" },
  deleteData: { es: "Eliminar datos", en: "Delete data" },
} satisfies Namespace;
