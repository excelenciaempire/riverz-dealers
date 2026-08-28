/**
 * Las secciones del panel, sin iconos.
 *
 * Existe separado de `sections.ts` por el proxy: `sections.ts` importa iconos de
 * lucide, y el proxy corre en CADA pedido, así que arrastrarlos ahí sería pagar
 * ese peso siempre. Esa era la razón por la que `lib/admin/host.ts` mantenía su
 * propia copia de la lista a mano — con el riesgo de que una sección nueva se
 * agregara en un lado y no en el otro, y en `admin.riverz.co` cayera al home sin
 * que nada fallara.
 *
 * Ahora la lista vive una sola vez, acá, y los dos la importan.
 */
export type AdminGroup =
  | "comercios"
  | "plata"
  | "observabilidad"
  | "configuracion";

export interface AdminSectionMeta {
  href: string;
  /** Clave i18n del nombre. */
  label: string;
  /** Clave i18n de la descripción. */
  description: string;
  group: AdminGroup;
}

export const ADMIN_SECTION_LIST: AdminSectionMeta[] = [
  {
    href: "/admin/ia",
    label: "admin.sectionAiKey",
    description: "admin.sectionAiKeyDesc",
    group: "configuracion",
  },
  {
    href: "/admin/whatsapp",
    label: "admin.sectionPlatformWhatsapp",
    description: "admin.sectionPlatformWhatsappDesc",
    group: "configuracion",
  },

  // ── Comercios y su consumo ──
  {
    href: "/admin/comercios",
    label: "admin.sectionWorkspaces",
    description: "admin.sectionWorkspacesDesc",
    group: "comercios",
  },
  {
    href: "/admin/usuarios",
    label: "admin.sectionUsers",
    description: "admin.sectionUsersDesc",
    group: "comercios",
  },
  {
    href: "/admin/conversaciones",
    label: "admin.sectionConversations",
    description: "admin.sectionConversationsDesc",
    group: "comercios",
  },
  {
    href: "/admin/saldos",
    label: "admin.sectionBalances",
    description: "admin.sectionBalancesDesc",
    group: "plata",
  },
  {
    href: "/admin/negocio",
    label: "admin.sectionBusiness",
    description: "admin.sectionBusinessDesc",
    group: "plata",
  },
  {
    href: "/admin/uso",
    label: "admin.sectionUsage",
    description: "admin.sectionUsageDesc",
    group: "plata",
  },
  {
    href: "/admin/codigos",
    label: "admin.sectionCodes",
    description: "admin.sectionCodesDesc",
    group: "comercios",
  },
  {
    href: "/admin/lista-espera",
    label: "admin.sectionWaitlist",
    description: "admin.sectionWaitlistDesc",
    group: "comercios",
  },

  // ── Qué está pasando ──
  {
    href: "/admin/logs",
    label: "admin.sectionLogs",
    description: "admin.sectionLogsDesc",
    group: "observabilidad",
  },
  {
    href: "/admin/canales",
    label: "admin.sectionChannels",
    description: "admin.sectionChannelsDesc",
    group: "observabilidad",
  },
  {
    href: "/admin/operacion",
    label: "admin.sectionOps",
    description: "admin.sectionOpsDesc",
    group: "observabilidad",
  },
  {
    href: "/admin/infra",
    label: "admin.infraTitle",
    description: "admin.infraDesc",
    group: "observabilidad",
  },
  {
    href: "/admin/auditoria",
    label: "admin.sectionAudit",
    description: "admin.sectionAuditDesc",
    group: "observabilidad",
  },

  // ── Configuración de plataforma (lo único que se escribe) ──
  {
    href: "/admin/funcionalidades",
    label: "admin.sectionFeatures",
    description: "admin.sectionFeaturesDesc",
    group: "configuracion",
  },
  {
    href: "/admin/voz",
    label: "admin.sectionVoice",
    description: "admin.sectionVoiceDesc",
    group: "configuracion",
  },
];

/** Los slugs, para el reescritor del subdominio. */
export const ADMIN_SLUGS: ReadonlySet<string> = new Set(
  ADMIN_SECTION_LIST.map((s) => s.href.replace(/^\/admin\//, "")),
);
