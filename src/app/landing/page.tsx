import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { Landing } from "@/components/landing/landing";

// Segunda redacción de la portada, servida en /landing para poder leer las dos
// en vivo y una al lado de la otra. Es la MISMA página: mismos componentes,
// mismas secciones, mismas animaciones — solo cambia el catálogo de copy
// (`landingV2` en vez de `landing`).
//
// A diferencia de la raíz, aquí no se redirige al panel si hay sesión: quien
// entra a esta URL viene a revisar el texto, no a usar la app.
export const dynamic = "force-dynamic";

// Fuera del índice: mismo contenido que la raíz con otras palabras, así que
// indexarla sería competirse a sí misma por las mismas búsquedas.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { absolute: t("landingV2.metaTitle") },
    description: t("landingV2.metaDescription"),
    robots: { index: false, follow: false },
  };
}

export default function LandingV2Page() {
  return <Landing copy="landingV2" />;
}
