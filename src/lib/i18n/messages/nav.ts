import type { Namespace } from "./types";

/** Sidebar navigation: group titles, item labels, footer + user menu. */
export const nav = {
  // Group titles
  groupDaily: { es: "Día a día", en: "Daily" },
  groupCustomerService: { es: "Servicio al cliente", en: "Customer service" },
  groupOutbound: { es: "Envíos", en: "Outbound" },
  groupStore: { es: "Tienda", en: "Store" },
  groupAnalytics: { es: "Análisis", en: "Analytics" },

  // Item labels
  // El chat que opera la cuenta. "Operador" y no "Chat" porque no es un lugar
  // donde conversar: es a quien le pedís que haga cosas.
  chat: { es: "Operador", en: "Operator" },
  operation: { es: "Operación", en: "Operation" },
  // Antes "Inicio". Dejó de ser una portada: es el tablero con todo lo que pasa
  // en la cuenta, y el nombre tiene que decir eso.
  home: { es: "Panel", en: "Dashboard" },
  inbox: { es: "Bandeja", en: "Inbox" },
  contacts: { es: "Contactos", en: "Contacts" },
  assistant: { es: "Asistente IA", en: "AI Assistant" },
  flows: { es: "Flujos", en: "Flows" },
  voice: { es: "Llamadas", en: "Calls" },
  webchat: { es: "Chat web", en: "Web chat" },
  admin: { es: "Admin", en: "Admin" },
  campaigns: { es: "Campañas", en: "Campaigns" },
  automations: { es: "Automatizaciones", en: "Automations" },
  templates: { es: "Plantillas", en: "Templates" },
  instagramAgent: { es: "Prospección IA", en: "AI Prospecting" },
  comments: { es: "Comentarios", en: "Comments" },
  products: { es: "Productos", en: "Products" },
  orders: { es: "Pedidos", en: "Orders" },
  returns: { es: "Devoluciones", en: "Returns" },
  approvals: { es: "Aprobaciones", en: "Approvals" },
  metrics: { es: "Rendimiento", en: "Performance" },
  team: { es: "Equipo", en: "Team" },
  integrations: { es: "Integraciones", en: "Integrations" },
  settings: { es: "Ajustes", en: "Settings" },

  // El saldo en el pie del menú. Mismo nombre que la pestaña de Ajustes a la
  // que lleva: dos palabras distintas para el mismo lugar es una pregunta de
  // más para el que busca dónde recargar.
  balance: { es: "Saldo", en: "Balance" },

  // User menu + footer
  profile: { es: "Perfil", en: "Profile" },
  signOut: { es: "Cerrar sesión", en: "Sign out" },
  user: { es: "Usuario", en: "User" },

  // Badges
  beta: { es: "Beta", en: "Beta" },
  betaFeature: { es: "Función Beta", en: "Beta feature" },
  unread: { es: "{n} sin leer", en: "{n} unread" },

  // Aria / controls
  main: { es: "Principal", en: "Main" },
  closeMenu: { es: "Cerrar menú", en: "Close menu" },
  expandMenu: { es: "Expandir menú", en: "Expand menu" },
  collapseMenu: { es: "Contraer menú", en: "Collapse menu" },
  switchToLight: { es: "Cambiar a tema claro", en: "Switch to light theme" },
  switchToDark: { es: "Cambiar a tema oscuro", en: "Switch to dark theme" },
  toggleTheme: { es: "Cambiar tema", en: "Toggle theme" },
  lightTheme: { es: "Tema claro", en: "Light theme" },
  darkTheme: { es: "Tema oscuro", en: "Dark theme" },

  // Cuenta suspendida. Neutro a propósito: la suspensión también cubre bajas
  // voluntarias y cuentas de prueba que se cierran.
  suspendedTitle: { es: "Tu cuenta está en pausa", en: "Your account is paused" },
  suspendedBody: {
    es: "Tus datos y tus conversaciones están guardados. Escríbenos y la reactivamos.",
    en: "Your data and conversations are saved. Write to us and we'll turn it back on.",
  },
  suspendedCta: { es: "Escribirnos", en: "Contact us" },
} satisfies Namespace;
