import { Skeleton } from '@/components/dashboard/skeleton'

/**
 * La bandeja mientras carga.
 *
 * Copia el `-m-4 … h-dvh` de la pantalla real para que la lista y el hilo
 * queden donde van a quedar: si el esqueleto tuviera otra forma, al llegar los
 * datos todo saltaría de lugar, que se ve peor que no haber puesto nada.
 */
export default function Loading() {
  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] overflow-hidden sm:-m-6 lg:-m-8 lg:h-dvh">
      <div className="hidden w-80 shrink-0 flex-col gap-3 border-r border-border p-4 sm:flex">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-14 w-2/3 rounded-2xl" />
          <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          <Skeleton className="h-16 w-3/5 rounded-2xl" />
        </div>
        <div className="border-t border-border p-4">
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
