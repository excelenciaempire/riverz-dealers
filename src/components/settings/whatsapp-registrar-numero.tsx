'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

/**
 * Un número propio que Meta no dejó registrar porque ya tenía verificación en
 * dos pasos con otro PIN. Sin registrar no envía nada; con el PIN del
 * comercio queda listo sin reconectar.
 */
export function WhatsAppRegistrarNumero({
  connectionId,
  onRegistrado,
}: {
  connectionId: string;
  onRegistrado: () => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  const registrar = async () => {
    setEnviando(true);
    try {
      const r = await fetchWithCsrf('/api/connections/whatsapp/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connectionId, pin }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error || t('settings.genericError'));
        return;
      }
      toast.success(t('settings.whatsappRegistrado'));
      onRegistrado();
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mt-1 space-y-1 pl-6">
      <p className="text-[10px] leading-snug text-red-600 dark:text-red-400">
        {t('settings.whatsappSinRegistrar')}
      </p>
      <div className="flex gap-1.5">
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="off"
          placeholder={t('settings.whatsappPin')}
          aria-label={t('settings.whatsappPin')}
          className="border-input bg-background h-7 w-28 rounded-md border px-2 text-xs"
        />
        <button
          type="button"
          onClick={() => void registrar()}
          disabled={pin.length !== 6 || enviando}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium disabled:opacity-60"
        >
          {enviando ? <Loader2 className="size-3 animate-spin" /> : null}
          {t('settings.whatsappRegistrar')}
        </button>
      </div>
    </div>
  );
}
