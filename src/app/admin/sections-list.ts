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
  // Antes eran dos —Saldos e Infraestructura—, que sondeaban los mismos cinco
  // proveedores por caminos distintos y podían contradecirse. Va en «la plata»
  // y no en «qué está pasando» porque contesta cuánto hay que pagar, no qué se
  // rompió: eso ya lo dice el bloque de avisos del índice.
  {
    href: "/admin/proveedores",
    label: "admin.sectionProviders",
    description: "admin.sectionProvidersDesc",
    group: "plata",
  },
  {
    href: "/admin/negocio",
    label: "admin.sectionBusiness",
    description: "admin.sectionBusinessDesc",
    group: "plata",
  },
  // Proveedores dice cuánto le queda a cada API y Negocio cuánto factura
  // Riverz. Ninguna contesta la pregunta que las une —«¿tengo con qué pagar lo
  // que los comercios van a consumir esta semana?»— porque la plata pasa por
  // tres plazos distintos: el comercio gasta hoy, Stripe deposita a los dos
  // días hábiles y el proveedor cobra por adelantado.
  {
    href: "/admin/caja",
    label: "admin.sectionCash",
    description: "admin.sectionCashDesc",
    group: "plata",
  },
  // Las llaves salieron de las filas de Proveedores: allá se contesta cuánto
  // sale y cuánto queda, acá con qué llave trabaja la plataforma. Estaban
  // mezcladas y ninguna de las dos preguntas se leía de un vistazo.
  {
    href: "/admin/claves",
    label: "admin.sectionKeys",
    description: "admin.sectionKeysDesc",
    group: "configuracion",
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

/**
 * Secciones retiradas, y a dónde fueron.
 *
 * Hace falta porque el reescritor del subdominio manda al home todo lo que no
 * reconoce: un enlace guardado a una sección que ya no existe no falla, aterriza
 * en el índice — que se lee como "funcionó" y es peor que un error. Acá se dice
 * a dónde fue cada una, y lo usan tanto `host.ts` (admin.riverz.co/saldos) como
 * `next.config.ts` (riverz.co/admin/saldos).
 */
export const ADMIN_SLUGS_RETIRADOS: Record<string, string> = {
  // Fusionadas en Proveedores: sondeaban los mismos proveedores por caminos
  // distintos y podían mostrar números distintos.
  saldos: "proveedores",
  infra: "proveedores",
};
