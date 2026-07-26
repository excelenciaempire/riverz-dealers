import type { Namespace } from "./types";

/** Panel de plataforma (riverz.co/admin) — solo equipo Riverz. */
export const admin = {
  title: { es: "Admin", en: "Admin" },
  subtitle: { es: "Ajustes globales de la plataforma", en: "Platform-wide settings" },
  backToApp: { es: "Volver a la app", en: "Back to app" },
  sectionVoice: { es: "Modelo de voz", en: "Voice model" },
  sectionVoiceDesc: {
    es: "Stack STT · LLM · TTS que usan todas las cuentas.",
    en: "STT · LLM · TTS stack used by every account.",
  },
} satisfies Namespace;
