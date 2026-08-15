import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { isUnlocked, unlockConfigured } from "@/lib/admin/unlock";
import { AdminShell } from "./admin-shell";
import { UnlockForm } from "./unlock-form";

// Platform panel (riverz.co/admin). Lives OUTSIDE the (dashboard) group: it
// isn't a merchant surface, so it gets its own shell instead of the tenant
// sidebar. The gate here is the real one — every page under /admin is behind
// it, and each /api/admin route re-checks on its own.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/ingresar");
  // 404 rather than 403: a merchant who lands here never learns the panel exists.
  if (!isPlatformAdmin(user.email)) notFound();

  // Segunda llave: ser del equipo abre la puerta, la contraseña la cierra
  // detrás. Sin ella, la sesión del navegador ES el panel — y la lista del
  // equipo incluye cuentas que también son de un comercio.
  if (!(await isUnlocked(user.email ?? ""))) {
    return <UnlockForm configured={unlockConfigured()} />;
  }

  return <AdminShell email={user.email ?? ""}>{children}</AdminShell>;
}
