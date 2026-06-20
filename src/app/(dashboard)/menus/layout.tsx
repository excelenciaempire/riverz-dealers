import { RequiresConnection } from "@/components/common/requires-connection";
import { getT } from "@/lib/i18n/server";

export default async function FlowsLayout({ children }: { children: React.ReactNode }) {
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
