import { RequiresConnection } from "@/components/common/requires-connection";
import { getT } from "@/lib/i18n/server";
import { isDealerDeployment } from "@/lib/dealers/config";

export default async function AutomationsLayout({ children }: { children: React.ReactNode }) {
  // Dealers can prepare paused recipes before connecting a sending channel.
  // The page retains its WhatsApp notice and activation keeps server validation.
  if (isDealerDeployment()) return children;
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
