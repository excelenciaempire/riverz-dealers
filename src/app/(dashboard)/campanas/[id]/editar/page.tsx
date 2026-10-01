import { notFound } from 'next/navigation'
import BroadcastBuilder from '@/components/broadcasts/broadcast-builder'
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview'

export default async function EditBroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) notFound()
  const { id } = await params
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) notFound()
  return <BroadcastBuilder draftId={id} />
}
