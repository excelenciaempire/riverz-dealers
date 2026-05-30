import { RequiresConnection } from '@/components/common/requires-connection';

export default function TemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequiresConnection
      title="Conecta WhatsApp para gestionar plantillas"
      description="Las plantillas oficiales se envían a Meta para su aprobación. Necesitas tu cuenta de WhatsApp Business conectada para crearlas y sincronizarlas."
    >
      {children}
    </RequiresConnection>
  );
}
