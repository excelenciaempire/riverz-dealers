import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { isAdminHost } from "@/lib/admin/host";
import { actorDelPanel, unlockConfigured } from "@/lib/admin/unlock";
import { AdminShell } from "./admin-shell";
import { UnlockForm } from "./unlock-form";

// Platform panel (admin.riverz.co). Lives OUTSIDE the (dashboard) group: it
// isn't a merchant surface, so it gets its own shell instead of the tenant
// sidebar. Every /api/admin route re-checks on its own (`requireAdmin`).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Se entra directo con la contraseña del panel: no hace falta haber iniciado
  // sesión antes con una cuenta del equipo.
  const actor = await actorDelPanel();
  if (actor) return <AdminShell email={actor.email}>{children}</AdminShell>;

  // En su propio host el panel pide la contraseña. En el dominio del producto
  // (riverz.co/admin) sólo a quien ya es del equipo: un comercio que cae ahí no
  // se entera de que existe.
  const host = (await headers()).get("host");
  if (!isAdminHost(host)) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformAdmin(user.email)) notFound();
  }
  return <UnlockForm configured={unlockConfigured()} />;
}
