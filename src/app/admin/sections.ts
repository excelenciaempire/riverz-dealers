import {
  Battery,
  ToggleRight,
  Store,
  Users,
  Activity,
  Radio,
  ShieldCheck,
  Server,
  KeyRound,
  MessageCircle,
  DollarSign,
  MessagesSquare,
  Ticket,
  Wallet,
} from "lucide-react";

import {
  ADMIN_SECTION_LIST,
  type AdminGroup,
  type AdminSectionMeta,
} from "./sections-list";

/**
 * Secciones del panel de plataforma, con su icono.
 *
 * La lista en sí vive en `sections-list.ts`, sin iconos, porque el proxy la
 * necesita en cada pedido y no puede cargar lucide. Acá sólo se le pega el
 * icono a cada una.
 *
 * `group` solo agrupa las tarjetas del home; la barra superior las lista
 * seguidas. Las etiquetas son cortas a propósito — con trece secciones, un
 * nombre largo rompe la barra en pantallas chicas.
 */
export type { AdminGroup };

export interface AdminSection extends AdminSectionMeta {
  icon: React.ComponentType<{ className?: string }>;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/admin/ia": KeyRound,
  "/admin/whatsapp": MessageCircle,
  "/admin/comercios": Store,
  "/admin/negocio": DollarSign,
  "/admin/proveedores": Battery,
  "/admin/caja": Wallet,
  "/admin/conversaciones": MessagesSquare,
  "/admin/usuarios": Users,
  "/admin/alta": Ticket,
  "/admin/conexiones": Radio,
  "/admin/operacion": Activity,
  "/admin/auditoria": ShieldCheck,
  "/admin/funcionalidades": ToggleRight,
};

export const ADMIN_SECTIONS: AdminSection[] = ADMIN_SECTION_LIST.map((s) => ({
  ...s,
  icon: ICONS[s.href] ?? Server,
}));

export const ADMIN_GROUPS: { key: AdminGroup; label: string }[] = [
  // El orden es el de las preguntas que se hacen al abrir el panel, y la
  // primera siempre es la plata: cuanto hay, cuanto entra y cuanto se debe.
  { key: "plata", label: "admin.groupMoney" },
  // Las APIs con las que Riverz trabaja: su saldo, su llave y su estado. Antes
  // estaban repartidas entre "la plata" (Proveedores) y "configuracion"
  // (Claves, IA, Voz), asi que responder "que APIs uso y como andan" pedia
  // abrir dos grupos.
  { key: "apis", label: "admin.groupApis" },
  { key: "comercios", label: "admin.groupWorkspaces" },
  { key: "que-pasa", label: "admin.groupObservability" },
  { key: "configuracion", label: "admin.groupConfig" },
];
