import { RequiresConnection } from "@/components/common/requires-connection";
import { getT } from "@/lib/i18n/server";

export default async function AutomationsLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <RequiresConnection
      title={t("automations.connectGateTitle")}
      description={t("automations.connectGateDescription")}
    >
      {children}
    </RequiresConnection>
  );
}
