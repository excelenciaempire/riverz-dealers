'use client';

import { ArrowRight, Check, Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useT } from '@/hooks/use-locale';

/**
 * Guía de conexión de WooCommerce.
 *
 * Conectar WooCommerce tiene un salto que las otras plataformas no
 * tienen: al comercio se lo manda a SU propio WordPress a aprobar un
 * acceso, y vuelve. Sin avisar antes, ese salto parece un error. Y
 * después queda un segundo paso —instalar el plugin— que si no se cuenta
 * ahí, no se hace nunca.
 *
 * De ahí las dos fases:
 *  - `before`: qué va a pasar al continuar. Tres líneas, no un manual.
 *  - `after`: la tienda ya quedó conectada; acá se ofrece el plugin, que
 *    es lo único que falta y el único momento en que el comercio tiene
 *    el contexto para entender para qué sirve.
 */

export type WooDialogPhase = 'before' | 'after';

interface Props {
  phase: WooDialogPhase | null;
  onClose: () => void;
  /** Solo en 'before': dispara la redirección a la aprobación. */
  onContinue?: () => void;
  busy?: boolean;
}

export function WooCommerceDialog({ phase, onClose, onContinue, busy }: Props) {
  const t = useT();

  return (
    <Dialog open={phase != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        {phase === 'before' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('settings.wooDialogBeforeTitle')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('settings.wooDialogBeforeIntro')}
              </DialogDescription>
            </DialogHeader>

            <ol className="space-y-2.5">
              <Step n={1} text={t('settings.wooDialogStep1')} />
              <Step n={2} text={t('settings.wooDialogStep2')} />
              <Step n={3} text={t('settings.wooDialogStep3')} />
            </ol>

            <button
              onClick={onContinue}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {t('settings.wooDialogContinue')}
            </button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                {t('settings.wooDialogAfterTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('settings.wooDialogAfterIntro')}
              </DialogDescription>
            </DialogHeader>

            <ol className="space-y-2.5">
              <Step n={1} text={t('settings.wooDialogInstall1')} />
              <Step n={2} text={t('settings.wooDialogInstall2')} />
              <Step n={3} text={t('settings.wooDialogInstall3')} />
            </ol>

            <a
              href="/api/woocommerce/plugin"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="size-4" />
              {t('settings.woocommerceDownloadPlugin')}
            </a>
            <button
              onClick={onClose}
              className="w-full py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t('settings.wooDialogLater')}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">
        {n}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{text}</span>
    </li>
  );
}
