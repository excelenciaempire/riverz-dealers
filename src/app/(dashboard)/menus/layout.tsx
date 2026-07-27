import { redirect } from "next/navigation";
import { RequiresConnection } from "@/components/common/requires-connection";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { getFeatureFlags, isFeatureEnabled } from "@/lib/admin/feature-flags";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";

export const dynamic = "force-dynamic";

export default async function FlowsLayout({ children }: { children: React.ReactNode }) {
  // Gate duro de la funcionalidad "Flujos". Si el admin la apagó (feature flag
  // `flows`), nadie abre /menus por URL — salvo un platform admin, que siempre
  // entra (para probarla apagada). Complementa el escondido del menú + la
  // redirección client-side con un corte en servidor.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isPlatformAdmin(user?.email)) {
    const flags = await getFeatureFlags(supabaseAdmin());
    if (!isFeatureEnabled(flags, "flows")) redirect("/panel");
  }

  const t = await getT();
  return (
    <RequiresConnection
      title={t("flows.connectChannelTitle")}
      description={t("flows.connectChannelDesc")}
    >
      {children}
    </RequiresConnection>
  );
}
