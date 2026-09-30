import { AlertTriangle, Wallet } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { getT } from '@/lib/i18n/server';
import type { Aviso } from '@/lib/wallet/puerta';
import { safeInvoiceUrl } from '@/lib/billing/pending-payment';

/**
 * La barra de arriba cuando algo del cobro necesita atención.
 *
 * Una sola línea, con la acción al final. No es un modal ni una tarjeta: el
 * comercio entró a trabajar, y taparle la pantalla para contarle algo que puede
 * resolver en un minuto es cobrarle el aviso con su tiempo.
 *
 * Dice qué pasa y qué hacer, en ese orden. "Te quedaste sin saldo" solo no
 * sirve: lo que la persona necesita saber es que **la IA dejó de responder**,
 * que es lo que va a notar aunque no lea esto.
 *
 * La cuenta que todavía no pagó no lleva acción: paga con el link que le manda
 * Riverz, con el trato que se pactó.
 */
export async function AvisoDeCobro({
  aviso,
  horas,
  invoiceUrl,
}: {
  aviso: Aviso;
  horas: number | null;
  invoiceUrl?: string | null;
}) {
  if (!aviso) return null;
  const t = await getT();

  const gracia = aviso === 'gracia';
  const pausada = aviso === 'mensualidad_pausada';
  const sinPagar = aviso === 'sin_pagar';
  const texto = gracia
    ? t('settings.avisoGracia', { n: horas ?? 0 })
    : pausada ? t('settings.avisoMensualidadPausada') : sinPagar
      ? t('settings.avisoSinPagar')
      : t('settings.avisoSinSaldo');
  const cta = gracia || pausada ? t('settings.avisoGraciaCta') : t('settings.avisoSinSaldoCta');
  const href = gracia ? '/ajustes?tab=billing' : '/ajustes?tab=saldo';
  const factura = safeInvoiceUrl(invoiceUrl);

  return (
    <div
      className={
        gracia || pausada
          ? 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-foreground'
          : 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-2 text-sm text-foreground'
      }
    >
      {gracia || pausada ? (
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
      ) : (
        <Wallet className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span>{texto}</span>
      {!sinPagar && (
        factura ? <a href={factura} target="_blank" rel="noopener noreferrer"
          className="font-medium underline underline-offset-2">{cta}</a> :
          <Link href={pausada ? '/ajustes?tab=billing' : href} className="font-medium underline underline-offset-2">
            {cta}
          </Link>
      )}
    </div>
  );
}
