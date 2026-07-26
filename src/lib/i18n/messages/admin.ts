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
  // Panel de infraestructura (saldo + estado en vivo de todo lo conectado)
  infraTitle: { es: "Infraestructura", en: "Infrastructure" },
  infraDesc: {
    es: "Saldo y estado en vivo de todas las APIs y servicios conectados.",
    en: "Live balance and status of every connected API and service.",
  },
  infraCatLlm: { es: "Modelos de IA (LLMs)", en: "AI models (LLMs)" },
  infraCatVoice: { es: "Voz y telefonía", en: "Voice & telephony" },
  infraCatInfra: { es: "Infraestructura", en: "Infrastructure" },
  infraCatMessaging: { es: "Mensajería", en: "Messaging" },
  infraRefresh: { es: "Actualizar", en: "Refresh" },
  infraLastCheck: { es: "Actualizado", en: "Updated" },
  infraStatusOk: { es: "Operativo", en: "Operational" },
  infraStatusLow: { es: "Saldo bajo", en: "Low balance" },
  infraStatusEmpty: { es: "Sin saldo", en: "No balance" },
  infraStatusError: { es: "Sin respuesta", en: "No response" },
  infraStatusNotConnected: { es: "No conectado", en: "Not connected" },
  infraLoading: { es: "Consultando servicios…", en: "Checking services…" },
} satisfies Namespace;
