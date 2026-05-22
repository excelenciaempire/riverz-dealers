import { RequiresConnection } from "@/components/common/requires-connection";

export default function AutomationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequiresConnection
      title="Conecta un canal antes de automatizar"
      description="Las automatizaciones disparan respuestas, etiquetas y acciones sobre mensajes reales. Conecta WhatsApp, Instagram, Messenger o un email primero y vuelve a esta pantalla."
    >
      {children}
    </RequiresConnection>
  );
}
