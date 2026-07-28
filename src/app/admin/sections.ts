import {
  SlidersHorizontal,
  ToggleRight,
  Store,
  Users,
  ScrollText,
  Activity,
  Gauge,
  Radio,
  ShieldCheck,
  Mailbox,
  Server,
} from "lucide-react";

/**
 * Secciones del panel de plataforma. Fuente única: barra superior + home.
 *
 * `group` solo agrupa las tarjetas del home; la barra superior las lista
 * seguidas. Las etiquetas son cortas a propósito — con once secciones, un
 * nombre largo rompe la barra en pantallas chicas.
 */
export type AdminGroup = "comercios" | "observabilidad" | "configuracion";

export interface AdminSection {
  href: string;
  /** Clave i18n del nombre. */
  label: string;
  /** Clave i18n de la descripción. */
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  group: AdminGroup;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  // ── Comercios y su consumo ──
  {
    href: "/admin/comercios",
    label: "admin.sectionWorkspaces",
    description: "admin.sectionWorkspacesDesc",
    icon: Store,
    group: "comercios",
  },
  {
    href: "/admin/usuarios",
    label: "admin.sectionUsers",
    description: "admin.sectionUsersDesc",
    icon: Users,
    group: "comercios",
  },
  {
    href: "/admin/uso",
    label: "admin.sectionUsage",
    description: "admin.sectionUsageDesc",
    icon: Gauge,
    group: "comercios",
  },
  {
    href: "/admin/lista-espera",
    label: "admin.sectionWaitlist",
    description: "admin.sectionWaitlistDesc",
    icon: Mailbox,
    group: "comercios",
  },

  // ── Qué está pasando ──
  {
    href: "/admin/logs",
    label: "admin.sectionLogs",
    description: "admin.sectionLogsDesc",
    icon: ScrollText,
    group: "observabilidad",
  },
  {
    href: "/admin/canales",
    label: "admin.sectionChannels",
    description: "admin.sectionChannelsDesc",
    icon: Radio,
    group: "observabilidad",
  },
  {
    href: "/admin/operacion",
    label: "admin.sectionOps",
    description: "admin.sectionOpsDesc",
    icon: Activity,
    group: "observabilidad",
  },
  {
    href: "/admin/infra",
    label: "admin.infraTitle",
    description: "admin.infraDesc",
    icon: Server,
    group: "observabilidad",
  },
  {
    href: "/admin/auditoria",
    label: "admin.sectionAudit",
    description: "admin.sectionAuditDesc",
    icon: ShieldCheck,
    group: "observabilidad",
  },

  // ── Configuración de plataforma (lo único que se escribe) ──
  {
    href: "/admin/funcionalidades",
    label: "admin.sectionFeatures",
    description: "admin.sectionFeaturesDesc",
    icon: ToggleRight,
    group: "configuracion",
  },
  {
    href: "/admin/voz",
    label: "admin.sectionVoice",
    description: "admin.sectionVoiceDesc",
    icon: SlidersHorizontal,
    group: "configuracion",
  },
];

export const ADMIN_GROUPS: { key: AdminGroup; label: string }[] = [
  { key: "comercios", label: "admin.groupWorkspaces" },
  { key: "observabilidad", label: "admin.groupObservability" },
  { key: "configuracion", label: "admin.groupConfig" },
];
