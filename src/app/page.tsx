import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Landing } from "@/components/landing/landing";

// Per-request: logged-in users go straight to the app; logged-out visitors
// (and Meta's reviewer) see the public marketing landing.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "riverz — CRM omnicanal con IA para WhatsApp, Instagram y Messenger",
  },
  description:
    "Atiende WhatsApp, Instagram, Messenger y correo desde una sola bandeja, con respuestas de IA, automatizaciones y campañas. Responde más rápido y vende más.",
  robots: { index: true, follow: true },
};

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/panel");
  return <Landing />;
}
