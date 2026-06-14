import { RequiresConnection } from '@/components/common/requires-connection';

export default function TemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequiresConnection
      title="Conecta WhatsApp para gestionar plantillas"
      description="Las plantillas se envían a Meta para su aprobación."
    >
      {children}
    </RequiresConnection>
  );
}
