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
} satisfies Namespace;
