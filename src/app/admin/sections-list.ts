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
  | "plata"
  | "apis"
  | "comercios"
  | "que-pasa"
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
    href: "/admin/onboarding",
    label: "onboarding.title",
    description: "onboarding.description",
    group: "comercios",
  },
  {
    href: "/admin/ia",
    label: "admin.sectionAiKey",
    description: "admin.sectionAiKeyDesc",
    group: "apis",
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
  // Las pruebas de "Probar como cliente", el feedback de pruebas y de
  // conversaciones reales, y la cola de lo que no se arregla con una regla:
  // cómo le está yendo al asistente de cada comercio y qué hay que tocar.
  {
    href: "/admin/mejoras",
    label: "admin.sectionMejoras",
    description: "admin.sectionMejorasDesc",
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
    group: "apis",
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
  // Las dos mitades del mismo embudo: quien dejo su correo antes de que hubiera
  // producto, y quien tiene con que crear la cuenta. Separadas, habia que
  // acordarse de mirar las dos para contestar como viene el alta.
  {
    href: "/admin/alta",
    label: "admin.sectionSignup",
    description: "admin.sectionSignupDesc",
    group: "comercios",
  },

  // ── Qué está pasando ──
  {
    href: "/admin/conexiones",
    label: "admin.sectionConnections",
    description: "admin.sectionConnectionsDesc",
    group: "que-pasa",
  },
  {
    href: "/admin/operacion",
    label: "admin.sectionOps",
    description: "admin.sectionOpsDesc",
    group: "que-pasa",
  },
  {
    href: "/admin/auditoria",
    label: "admin.sectionAudit",
    description: "admin.sectionAuditDesc",
    group: "que-pasa",
  },

  // ── Configuración de plataforma (lo único que se escribe) ──
  {
    href: "/admin/funcionalidades",
    label: "admin.sectionFeatures",
    description: "admin.sectionFeaturesDesc",
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
  // Las dos mitades del embudo de alta, ahora en una seccion con pestanas.
  codigos: "alta",
  "lista-espera": "alta",
  // El historial es una pestaña de Operación: la misma pregunta a dos
  // distancias, y los webhooks sin procesar se listaban en las dos.
  logs: "operacion",
  // "Canales" quedaba corto: la tabla no lista canales sino CONEXIONES, una
  // fila por cuenta conectada de cada comercio, y ahi adentro hay tiendas,
  // pagos y contra reembolso ademas de mensajeria.
  canales: "conexiones",
  // Las llaves vuelven a Proveedores, como pestana: eran dos secciones sobre
  // los MISMOS nueve proveedores, y para saber por que uno no contesta habia
  // que abrir las dos y cruzarlas a mano.
  claves: "proveedores",
  // El stack de voz es una pestana de IA: las dos contestan con que modelo y
  // con que llave trabaja Riverz, y "modelo" aparecia dos veces en el indice
  // sin que ninguna dijera cual.
  voz: "ia",
  // Uso y costos era una tabla por comercio con una columna de costo, igual
  // que la de Cuentas. Dos tablas parecidas con universos distintos y metricas
  // que no se pueden comparar; una al lado de la otra, la diferencia se lee.
  uso: "negocio",
};
