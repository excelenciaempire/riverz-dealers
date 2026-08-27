'use client'

import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Atribucion, SourceKind } from '@/lib/dashboard/use-attribution'

/**
 * La cifra, abierta.
 *
 * «Ventas por Riverz: 1.499.730» es una suma, y una suma no se verifica. Acá
 * está el renglón por renglón que la sostiene: qué pedido, de quién, por
 * cuánto, y qué mensaje de Riverz llegó antes de la compra. Con el número de
 * pedido el comercio abre su tienda y comprueba que la plata existe.
 *
 * Arriba va el modelo en una línea, porque sin él el detalle no se entiende:
 * no decimos que Riverz causó la venta, decimos que Riverz habló con esa
 * persona antes de que comprara. Es último toque con ventana, igual que
 * cualquier panel de anuncios — y hay que decirlo, no esconderlo.
 */
export function DetalleAtribucion({
  data,
  abierto,
  onAbierto,
}: {
  data: Atribucion | null
  abierto: boolean
  onAbierto: (v: boolean) => void
}) {
  const t = useT()
  const fmt = useFormat()

  const pedidos = data?.attributed_orders ?? []
  const total = data?.attributed
  const ventasTienda = data?.totals?.revenue.current ?? 0

  return (
    <Dialog open={abierto} onOpenChange={onAbierto}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('dashboard.attrDetailTitle')}</DialogTitle>
          <DialogDescription>{t('dashboard.attrModel')}</DialogDescription>
        </DialogHeader>

        {total && total.orders > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
            <Cifra
              etiqueta={t('dashboard.attrByRiverz')}
              valor={fmt.money(total.revenue, total.currency)}
            />
            <Cifra
              etiqueta={t('dashboard.attrOrders')}
              valor={fmt.number(total.orders)}
            />
            <Cifra
              etiqueta={t('dashboard.attrStoreTotal')}
              valor={fmt.money(ventasTienda, data?.totals?.currency)}
            />
          </div>
        )}

        {pedidos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.attrEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {pedidos.map((p) => (
              <li key={p.id} className="py-2.5 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {p.reference}
                    {p.contact && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        {p.contact}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                    {fmt.money(p.revenue, p.currency)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmt.dateTime(p.created_at)}
                  {p.sources.map((s) => (
                    <span key={`${s.kind}-${s.at}`}>
                      {' · '}
                      {t(kindKey(s.kind))}: {s.name}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}

        {data?.attributed_orders_truncated && (
          <p className="text-xs text-muted-foreground">
            {t('dashboard.attrTruncated', { n: pedidos.length })}
          </p>
        )}

        <p className="text-xs leading-snug text-muted-foreground">
          {t('dashboard.attrCaveat')}
        </p>
      </DialogContent>
    </Dialog>
  )
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <span className="font-medium tabular-nums text-foreground">{valor}</span>
    </span>
  )
}

function kindKey(kind: SourceKind): string {
  return kind === 'automation'
    ? 'health.kindAutomation'
    : kind === 'broadcast'
      ? 'health.kindBroadcast'
      : kind === 'flow'
        ? 'health.kindFlow'
        : 'health.kindAgent'
}
