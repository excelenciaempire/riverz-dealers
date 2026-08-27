import { getT } from '@/lib/i18n/server'
import { Pliego } from '@/components/operacion/pliego'

export default async function PliegoPage() {
  const t = await getT()
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground">{t('pliego.titulo')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pliego.bajada')}</p>
      </div>
      <Pliego />
    </div>
  )
}
