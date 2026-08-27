import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { LandingV3 } from "@/components/landing/v3/landing-v3";

// Tercera portada, «Papel y Señal», servida acá para poder compararla en vivo
// contra `/` y `/landing` sin tocar ninguna de las dos. A diferencia de la
// raíz, no redirige al panel si hay sesión: quien entra viene a revisar el
// diseño, no a usar la app.
export const dynamic = "force-dynamic";

// Fuera del índice: el mismo producto con otro diseño, así que indexarla sería
// competirle a la portada real por las mismas búsquedas.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { absolute: t("landingV3.metaTitle") },
    description: t("landingV3.metaDescription"),
    robots: { index: false, follow: false },
  };
}

export default function PortadaPage() {
  return <LandingV3 />;
}
