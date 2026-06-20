import { RequiresConnection } from '@/components/common/requires-connection';
import { getT } from '@/lib/i18n/server';

export default async function TemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getT();
  return (
    <RequiresConnection
      title={t('templates.connectToManage')}
      description={t('templates.connectDescription')}
    >
      {children}
    </RequiresConnection>
  );
}
