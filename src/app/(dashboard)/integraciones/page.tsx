'use client';

import { Suspense } from 'react';
import { ChannelsPanel } from '@/components/settings/channels-panel';
import { ConnectionResult } from '@/components/settings/connection-result';
import { useT } from '@/hooks/use-locale';

/**
 * /integraciones — todas las apps externas y canales que se conectan a
 * la cuenta (WhatsApp, Meta, Google, Microsoft, tiendas, Mercado Pago,
 * Klaviyo). Antes vivía como un tab dentro de /ajustes; ahora es su
 * propia página para que el onboarding ("conecta WhatsApp", "conecta
 * Shopify") tenga un home propio y no se mezcle con perfil / equipo.
 *
 * Todo va en una sola grilla: las integraciones que colgaban debajo con
 * su propio título quedaban fuera del lugar donde se buscan.
 */
export default function IntegracionesPage() {
  const t = useT();
  return (
    <div className="space-y-5">
      {/* useSearchParams necesita un límite de Suspense. */}
      <Suspense fallback={null}>
        <ConnectionResult />
      </Suspense>

      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('settings.integrations')}</h1>
      </div>

      <ChannelsPanel />
    </div>
  );
}
