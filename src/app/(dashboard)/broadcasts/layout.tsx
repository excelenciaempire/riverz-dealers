import { RequiresConnection } from "@/components/common/requires-connection";

export default function BroadcastsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequiresConnection
      title="Conecta un canal antes de difundir"
      description="Las difusiones envían mensajes a muchos contactos a la vez. Necesitas al menos un canal oficial conectado (WhatsApp, Instagram, email…) para enviar."
    >
      {children}
    </RequiresConnection>
  );
}
