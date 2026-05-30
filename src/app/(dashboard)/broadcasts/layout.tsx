import { RequiresConnection } from "@/components/common/requires-connection";

export default function BroadcastsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequiresConnection
      title="Conecta un canal antes de difundir"
      description="Necesitas al menos un canal oficial conectado para enviar."
    >
      {children}
    </RequiresConnection>
  );
}
