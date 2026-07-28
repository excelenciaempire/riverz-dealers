'use client';

import { Check, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useT } from '@/hooks/use-locale';

/**
 * Qué hacer después de conectar WooCommerce.
 *
 * No hay un diálogo ANTES de mandar al comercio a aprobar: el resto de
 * los canales (Meta, Gmail, Mercado Libre, Tiendanube…) también salen de
 * Riverz sin avisar, y avisar solo acá sería un paso de más y una
 * inconsistencia.
 *
 * Este sí hace falta. Conectar no termina el trabajo: WooCommerce no
 * registra carritos abandonados y el plugin es lo que lo resuelve. Sin
 * contarlo en el único momento en que el comercio tiene el contexto para
 * entenderlo, no se instala nunca.
 */
export function WooCommerceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
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
