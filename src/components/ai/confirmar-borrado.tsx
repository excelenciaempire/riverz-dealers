'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Confirmación dentro de la página (el confirm() nativo no siempre se ve). */
export function ConfirmarBorrado({
  abierto,
  onCerrar,
  titulo,
  onBorrar,
  descripcion,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  onBorrar: () => Promise<void>;
  descripcion?: string;
}) {
  const t = useT();
  const [borrando, setBorrando] = useState(false);
  return (
    <Dialog open={abierto} onOpenChange={(v) => { if (!v) onCerrar(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion ?? t('assistant.pruebasBorrarAviso')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar} disabled={borrando}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={borrando}
            onClick={async () => {
              setBorrando(true);
              try {
                await onBorrar();
              } finally {
                setBorrando(false);
                onCerrar();
              }
            }}
          >
            {borrando ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
