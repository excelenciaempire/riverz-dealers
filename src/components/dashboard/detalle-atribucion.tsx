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
import type {
  AttributedOrder,
  Atribucion,
  ProofKind,
  SourceKind,
} from '@/lib/dashboard/use-attribution'

/**
 * La cifra, abierta — y sobre todo, separada.
 *
 * Arriba las PROBADAS: pedidos que traen una marca que puso Riverz. Abajo, en
 * su propio grupo y con su propio total, las INFLUIDAS: la persona habló con
 * Riverz y después compró, sin nada que lo pruebe. Esa venta puede haberla
 * traído un anuncio de Meta, y decir lo contrario es cobrar por trabajo ajeno.
 *
 * Cuando la conversación nació de un anuncio se marca en el renglón. No hay
 * ninguna razón para esconderlo: si el anuncio trajo a la persona y Riverz le
 * armó el pago, las dos cosas son ciertas y el comercio decide qué hacer con
 * eso mejor que nosotros.
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
  const probadas = pedidos.filter((p) => p.evidence === 'proven')
  const influidas = pedidos.filter((p) => p.evidence === 'assisted')
  const totalProbado = data?.attributed
  const totalInfluido = data?.assisted

  return (
    <Dialog open={abierto} onOpenChange={onAbierto}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('dashboard.attrDetailTitle')}</DialogTitle>
          <DialogDescription>{t('dashboard.attrModel')}</DialogDescription>
        </DialogHeader>

        <section>
          <Encabezado
            titulo={t('dashboard.attrProvenTitle')}
            total={
              totalProbado && totalProbado.orders > 0
                ? t('dashboard.attrTotalLine', {
                    total: fmt.money(totalProbado.revenue, totalProbado.currency),
                    orders: totalProbado.orders,
                  })
                : null
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('dashboard.attrProvenHelp')}
          </p>
          {probadas.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('dashboard.attrProvenEmpty')}
            </p>
          ) : (
            <Lista pedidos={probadas} />
          )}
        </section>

        {influidas.length > 0 && (
          <section>
            <Encabezado
              titulo={t('dashboard.attrAssistedTitle')}
              total={
                totalInfluido && totalInfluido.orders > 0
                  ? t('dashboard.attrTotalLine', {
                      total: fmt.money(totalInfluido.revenue, totalInfluido.currency),
                      orders: totalInfluido.orders,
                    })
                  : null
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('dashboard.attrAssistedHelp')}
            </p>
            <Lista pedidos={influidas} />
          </section>
        )}

        {data?.attributed_orders_truncated && (
          <p className="text-xs text-muted-foreground">
            {t('dashboard.attrTruncated', { n: pedidos.length })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Encabezado({ titulo, total }: { titulo: string; total: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      {total && <span className="text-xs tabular-nums text-muted-foreground">{total}</span>}
    </div>
  )
}

function Lista({ pedidos }: { pedidos: AttributedOrder[] }) {
  const t = useT()
  const fmt = useFormat()

  return (
    <ul className="mt-2 divide-y divide-border/60">
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
            {p.proofs.map((pr) => (
              <span key={pr.kind} className="text-foreground">
                {' · '}
                {t(proofKey(pr.kind))}
                {pr.detail && pr.kind === 'coupon' ? ` ${pr.detail}` : ''}
              </span>
            ))}
            {p.sources.map((s) => (
              <span key={`${s.kind}-${s.at}`}>
                {' · '}
                {t(kindKey(s.kind))}: {s.name}
              </span>
            ))}
            {p.from_ad && <span>{' · '}{t('dashboard.attrFromAd')}</span>}
          </p>
        </li>
      ))}
    </ul>
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

function proofKey(kind: ProofKind): string {
  return kind === 'order_created'
    ? 'dashboard.proofOrderCreated'
    : kind === 'checkout_link'
      ? 'dashboard.proofCheckoutLink'
      : kind === 'webchat_cart'
        ? 'dashboard.proofWebchatCart'
        : 'dashboard.proofCoupon'
}
