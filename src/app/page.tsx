import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getT, getLocale } from "@/lib/i18n/server";
import { Landing } from "@/components/landing/landing";

// Per-request: logged-in users go straight to the app; logged-out visitors
// (and Meta's reviewer) see the public marketing landing.
export const dynamic = "force-dynamic";

// Locale-aware metadata: resolved per request via the server `t()` so the
// browser tab, search snippets and share previews follow the visitor's
// language. The locale cookie is the single source of truth (force-dynamic
// makes cookies()/getT safe here).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const ogTitle = t("landing.ogTitle");
  const ogDescription = t("landing.ogDescription");
  return {
    title: {
      absolute: t("landing.metaTitle"),
    },
    description: t("landing.metaDescription"),
    robots: { index: true, follow: true },
    alternates: { canonical: "/" },
    // The share preview uses the brand hook (matches the landing hero); the
    // image comes from the site-wide opengraph-image.tsx / twitter-image.tsx.
    openGraph: {
      type: "website",
      siteName: "riverz",
      url: "/",
      // La página se renderiza en el idioma del visitante: anunciar siempre
      // es_ES hacía que un share en inglés se declarara en español.
      locale: (await getLocale()) === "en" ? "en_US" : "es_ES",
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
  const data = structuredData(await getLocale(), t("landing.metaDescription"));

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
      />
      <Landing />
    </>
  );
}
