import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton'

/**
 * Lo que se ve mientras el servidor arma la pantalla.
 *
 * Sin esto, un clic en el menú no hace nada visible hasta que el segmento
 * entero terminó de renderizarse en el servidor: la pantalla vieja se queda
 * quieta y la navegación se siente rota aunque tarde poco.
 *
 * No lleva texto a propósito. Un cartel de "Cargando…" habría que traducirlo y
 * además envejece peor: cuando la respuesta llega rápido, alcanzás a leerlo y
 * parpadea. Las formas grises no dicen nada y no hay nada que traducir.
 *
 * Este es el genérico del dashboard. Las tres pantallas pesadas tienen el suyo
 * con su propia forma, para que lo que aparece se parezca a lo que llega.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
