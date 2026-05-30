import { RequiresConnection } from "@/components/common/requires-connection";

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequiresConnection
      title="Conecta un canal antes de crear flujos"
      description="Necesitas un canal oficial conectado para enviar mensajes."
    >
      {children}
    </RequiresConnection>
  );
}
