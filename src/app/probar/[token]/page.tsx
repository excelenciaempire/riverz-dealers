'use client';

import { use, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CsrfProvider } from '@/components/auth/csrf-provider';
import { ProbarComoCliente } from '@/components/ai/probar-como-cliente';
import { useT } from '@/hooks/use-locale';

/**
 * "Probar como cliente" por link, sin entrar a Riverz.
 *
 * Es la misma prueba que ve el comercio en Asistente, para mandársela a quien
 * no tiene usuario —el dueño de la marca— y que converse como cliente desde el
 * teléfono. El link lo firma el servidor y vence solo (`ai/prueba-compartida`).
 */
export default function ProbarCompartidoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useT();
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'invalido'>('cargando');
  const [comercio, setComercio] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/ai/probar?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => {
        const json = r.ok ? ((await r.json()) as { comercio?: string | null }) : null;
        if (cancelado) return;
        if (!json) return setEstado('invalido');
        setComercio(json.comercio ?? null);
        setEstado('listo');
      })
      .catch(() => {
        if (!cancelado) setEstado('invalido');
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  return (
    <CsrfProvider>
      <main className="bg-background min-h-screen px-4 py-6 sm:py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          {estado === 'cargando' ? (
            <div className="flex justify-center py-24">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : estado === 'invalido' ? (
            <p className="text-muted-foreground py-24 text-center text-sm">{t('assistant.probarLinkInvalido')}</p>
          ) : (
            <>
              <header className="space-y-1">
                <h1 className="text-foreground text-xl font-semibold">
                  {t('assistant.probarPaginaTitulo', { comercio: comercio ?? '' })}
                </h1>
                <p className="text-muted-foreground text-sm">{t('assistant.probarHint')}</p>
              </header>
              <ProbarComoCliente token={token} nombreComercio={comercio} />
            </>
          )}
        </div>
      </main>
    </CsrfProvider>
  );
}
