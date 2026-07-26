import { SlidersHorizontal } from "lucide-react";

/** Secciones del panel de plataforma. Fuente única: barra superior + home. */
export const ADMIN_SECTIONS = [
  {
    href: "/admin/voz",
    label: "admin.sectionVoice",
    description: "admin.sectionVoiceDesc",
    icon: SlidersHorizontal,
  },
] as const;
