'use client'

import Link from '@/components/i18n/locale-link'
import { useT } from '@/hooks/use-locale'
import { PackageOpen, ShieldQuestion, Truck } from 'lucide-react'

export function OperationLinks({ contactId }: { contactId: string }) {
  const t = useT()
  const contact = encodeURIComponent(contactId)
  return <div className="mt-3 flex flex-wrap gap-2">
    <Link href={`/aprobaciones?contact_id=${contact}`} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
      <ShieldQuestion className="size-3.5" />{t('approvals.title')}
    </Link>
    <Link href={`/devoluciones?contact_id=${contact}`} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
      <PackageOpen className="size-3.5" />{t('returns.title')}
    </Link>
    <Link href="/logistica" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
      <Truck className="size-3.5" />{t('logistics.title')}
    </Link>
  </div>
}
