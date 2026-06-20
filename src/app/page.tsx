import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Landing } from "@/components/landing/landing";

// Per-request: logged-in users go straight to the app; logged-out visitors
// (and Meta's reviewer) see the public marketing landing.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "riverz — Agente de IA que vende por WhatsApp e Instagram",
  },
  description:
    "Un agente de IA que atiende, recomienda y cierra ventas en WhatsApp e Instagram. Recupera carritos, hace volver a tus clientes y te muestra cuánto vendes, 24/7.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  // The share preview uses the brand hook (matches the landing hero); the
  // image comes from the site-wide opengraph-image.tsx / twitter-image.tsx.
  openGraph: {
    type: "website",
    siteName: "riverz",
    url: "/",
    locale: "es_ES",
    title: "Convierte cada chat en una venta · riverz",
    description:
      "Un agente de IA que atiende, recomienda y cierra ventas en WhatsApp e Instagram. Recupera carritos y vende 24/7.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Convierte cada chat en una venta · riverz",
    description:
      "Un agente de IA que atiende, recomienda y cierra ventas en WhatsApp e Instagram. Recupera carritos y vende 24/7.",
  },
};

// Structured data (schema.org) for rich results and entity understanding in
// search. Emitted as a non-executable application/ld+json data block; it
// carries the per-request CSP nonce so it passes the strict script-src policy
// minted in src/proxy.ts. Identifiers are shared (@id) so Organization,
// WebSite and SoftwareApplication link into one graph.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://riverz.co/#organization",
      name: "riverz",
      url: "https://riverz.co",
      logo: "https://riverz.co/apple-icon",
      email: "info@riverzai.com",
      description:
        "Agente de IA que atiende, recomienda y cierra ventas por WhatsApp e Instagram.",
    },
    {
      "@type": "WebSite",
      "@id": "https://riverz.co/#website",
      url: "https://riverz.co",
      name: "riverz",
      inLanguage: "es",
      publisher: { "@id": "https://riverz.co/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      name: "riverz",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://riverz.co",
      description:
        "CRM con un agente de IA que atiende, recomienda y cierra ventas en WhatsApp e Instagram. Recupera carritos, hace volver a tus clientes y mide cada venta, 24/7.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Empezar gratis",
      },
      publisher: { "@id": "https://riverz.co/#organization" },
    },
  ],
};

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/panel");

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <Landing />
    </>
  );
}
