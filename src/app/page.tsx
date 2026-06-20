import { redirect } from "next/navigation";
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

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/panel");
  return <Landing />;
}
