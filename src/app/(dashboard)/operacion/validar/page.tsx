import { getT } from '@/lib/i18n/server';
import { ValidationPanel } from '@/components/operacion/validation-panel';

export default async function ValidarOperacionPage() {
  const t = await getT();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('operation.validationTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('operation.validationHint')}</p>
      </div>
      <ValidationPanel />
    </div>
  );
}
