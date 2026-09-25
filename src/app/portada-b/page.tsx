import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { LandingV4 } from "@/components/landing/v4/landing-v4";
import { publicPricing } from "@/lib/billing/public-pricing";

// Cuarta portada, en registro editorial, servida acá para poder compararla en
// vivo contra `/`, `/landing` y `/portada` sin tocar ninguna. Como las otras
// variantes, no redirige al panel si hay sesión: quien entra viene a revisar
// el diseño, no a usar la app.
export const dynamic = "force-dynamic";

// Fuera del índice: el mismo producto con otro diseño, así que indexarla sería
// competirle a la portada real por las mismas búsquedas.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { absolute: t("landingV4.metaTitle") },
    description: t("landingV4.metaDescription"),
    robots: { index: false, follow: false },
  };
}

export default async function PortadaBPage() {
  return <LandingV4 {...await publicPricing()} />;
}
