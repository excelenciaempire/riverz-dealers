import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getT, getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { LandingV4 } from "@/components/landing/v4/landing-v4";

// Idioma de la vista previa al compartir. Va atado al de la tarjeta
// (src/components/og/share-card.tsx), que se renderiza en español: si se
// traduce esa imagen, este valor deja de tener sentido fijo.
const SHARE_LOCALE = "es" as const;

// Per-request: logged-in users go straight to the app; logged-out visitors
// (and Meta's reviewer) see the public marketing landing.
//
// La portada es la editorial (`LandingV4`), la misma que se estuvo revisando en
// `/portada-b`. Esa URL sigue viva y sin indexar para no romper los enlaces
// compartidos; la version anterior (`Landing`) sigue existiendo y se sirve en
// `/landing`.
export const dynamic = "force-dynamic";

// Locale-aware metadata: resolved per request via the server `t()` so the
// browser tab, search snippets and share previews follow the visitor's
// language. The locale cookie is the single source of truth (force-dynamic
// makes cookies()/getT safe here).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // El título y la descripción de la pestaña siguen al visitante…
  // …pero la vista previa al compartir NO. El rastreador de Meta entra sin
  // cookie y desde IP de Estados Unidos, así que la detección de idioma le
  // servía inglés mientras la tarjeta (opengraph-image) está fija en español:
  // el link salía con imagen en español y titular en inglés. La previa se fija
  // al idioma de la tarjeta y deja de contradecirse.
  const ogTitle = translate(SHARE_LOCALE, "landing.ogTitle");
  const ogDescription = translate(SHARE_LOCALE, "landing.ogDescription");
  return {
    title: {
      absolute: t("landing.metaTitle"),
    },
    description: t("landingV4.metaDescription"),
    robots: { index: true, follow: true },
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: "riverz",
      url: "/",
      locale: "es_ES",
      title: ogTitle,
      description: ogDescription,
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
    },
  };
}

// Structured data (schema.org) for rich results and entity understanding in
// search. Emitted as a non-executable application/ld+json data block; it
// carries the per-request CSP nonce so it passes the strict script-src policy
// minted in src/proxy.ts. Identifiers are shared (@id) so Organization,
// WebSite and SoftwareApplication link into one graph. El texto sigue el
// idioma servido para que el snippet no contradiga a la página.
function structuredData(locale: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://riverz.co/#organization",
        name: "riverz",
        url: "https://riverz.co",
        logo: "https://riverz.co/apple-icon",
        email: "info@riverzai.com",
        description,
      },
      {
        "@type": "WebSite",
        "@id": "https://riverz.co/#website",
        url: "https://riverz.co",
        name: "riverz",
        inLanguage: locale,
        publisher: { "@id": "https://riverz.co/#organization" },
      },
      {
        "@type": "SoftwareApplication",
        name: "riverz",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: "https://riverz.co",
        description,
        publisher: { "@id": "https://riverz.co/#organization" },
      },
    ],
  };
}

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/panel");

  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const t = await getT();
  const data = structuredData(await getLocale(), t("landingV4.metaDescription"));

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
      />
      <LandingV4 />
    </>
  );
}
