import { getT } from '@/lib/i18n/server'
import { OperacionShell } from '@/components/operacion/shell'

export default async function OperacionPage() {
  const t = await getT()
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('operation.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('operation.subtitle')}</p>
      </div>
      <OperacionShell />
    </div>
  )
}
