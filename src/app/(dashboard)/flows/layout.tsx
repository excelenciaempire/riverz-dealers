import { RequiresConnection } from "@/components/common/requires-connection";

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequiresConnection
      title="Conecta un canal antes de crear flujos"
      description="Los flujos son bots conversacionales que dialogan con tus contactos. Conecta un canal oficial primero para que el flujo tenga por dónde hablar."
    >
      {children}
    </RequiresConnection>
  );
}
