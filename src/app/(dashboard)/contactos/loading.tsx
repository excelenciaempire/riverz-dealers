import { Skeleton } from '@/components/dashboard/skeleton'

/**
 * Contactos mientras carga. Es la pantalla que más tarda del dashboard: la
 * base entera pasa por el filtro del segmento antes de que se vea una fila.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
          >
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="hidden h-4 w-32 sm:block" />
            <Skeleton className="ml-auto h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
