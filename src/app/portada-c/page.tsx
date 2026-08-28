import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { LandingV5 } from "@/components/landing/v5/landing-v5";

// Tercera piel para el mismo producto, en el registro de shopify.com: negro de
// punta a punta, grotesca blanca y un degradado propio por sección. Sirve para
// compararla en vivo contra `/portada-b`, que es su opuesto exacto. Como las
// otras variantes, no redirige al panel si hay sesión.
export const dynamic = "force-dynamic";

// Fuera del índice: el mismo producto con otro diseño, así que indexarla sería
// competirle a la portada real por las mismas búsquedas.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { absolute: t("landingV5.metaTitle") },
    description: t("landingV4.metaDescription"),
    robots: { index: false, follow: false },
  };
}

export default function PortadaCPage() {
  return <LandingV5 />;
}
