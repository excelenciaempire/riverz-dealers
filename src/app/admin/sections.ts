import {
  Battery,
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
  KeyRound,
  MessageCircle,
  DollarSign,
  MessagesSquare,
  Ticket,
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
  "/admin/saldos": Battery,
  "/admin/conversaciones": MessagesSquare,
  "/admin/usuarios": Users,
  "/admin/uso": Gauge,
  "/admin/codigos": Ticket,
  "/admin/lista-espera": Mailbox,
  "/admin/logs": ScrollText,
  "/admin/canales": Radio,
  "/admin/operacion": Activity,
  "/admin/infra": Server,
  "/admin/auditoria": ShieldCheck,
  "/admin/funcionalidades": ToggleRight,
  "/admin/voz": SlidersHorizontal,
};

export const ADMIN_SECTIONS: AdminSection[] = ADMIN_SECTION_LIST.map((s) => ({
  ...s,
  icon: ICONS[s.href] ?? Server,
}));

export const ADMIN_GROUPS: { key: AdminGroup; label: string }[] = [
  { key: "comercios", label: "admin.groupWorkspaces" },
  // La plata va en su propio grupo: cuanto entra, cuanto se consume y cuanto
  // hay que pagar para que esto siga prendido son la misma pregunta, y estaban
  // repartidas entre "comercios" y "que esta pasando".
  { key: "plata", label: "admin.groupMoney" },
  { key: "observabilidad", label: "admin.groupObservability" },
  { key: "configuracion", label: "admin.groupConfig" },
];
