import { RequiresConnection } from "@/components/common/requires-connection";

export default function AutomationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequiresConnection
      title="Conecta un canal antes de automatizar"
      description="Conecta WhatsApp, Instagram, Messenger o un email para empezar."
    >
      {children}
    </RequiresConnection>
  );
}
