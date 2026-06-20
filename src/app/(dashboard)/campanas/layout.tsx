import { RequiresConnection } from "@/components/common/requires-connection";
import { getT } from "@/lib/i18n/server";

export default async function BroadcastsLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <RequiresConnection
      title={t("broadcasts.requiresConnectionTitle")}
      description={t("broadcasts.requiresConnectionDescription")}
    >
      {children}
    </RequiresConnection>
  );
}
