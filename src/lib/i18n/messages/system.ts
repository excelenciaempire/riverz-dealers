import type { Namespace } from "./types";

/** App-level system surfaces: route error, global error and not-found pages. */
export const system = {
  // Route error boundary (src/app/error.tsx)
  errorTitle: { es: "Algo salió mal", en: "Something went wrong" },
  errorDescription: {
    es: "Tuvimos un problema cargando esta vista. Puedes intentar de nuevo o volver al panel.",
    en: "We hit a problem loading this view. You can try again or go back to the dashboard.",
  },

  // Global error boundary (src/app/global-error.tsx)
  globalErrorTitle: {
    es: "Se interrumpió la aplicación",
    en: "The app was interrupted",
  },
  globalErrorDescription: {
    es: "Encontramos un error inesperado. Reintenta o vuelve al panel para continuar tu trabajo.",
    en: "We ran into an unexpected error. Try again or return to the dashboard to keep working.",
  },

  // Not found (src/app/not-found.tsx)
  notFoundTitle: { es: "No encontramos esta página", en: "We couldn't find this page" },
  notFoundDescription: {
    es: "El enlace puede estar roto o el contenido fue movido.",
    en: "The link may be broken or the content was moved.",
  },

  // Shared actions / labels
  retry: { es: "Reintentar", en: "Try again" },
  backHome: { es: "Volver al inicio", en: "Back to home" },
  refPrefix: { es: "ref", en: "ref" },
} satisfies Namespace;
