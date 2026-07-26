'use client';

import { ChannelsPanel } from '@/components/settings/channels-panel';
import { KlaviyoCard } from '@/components/settings/klaviyo-card';
import { ApifyCard } from '@/components/settings/apify-card';
import { useT } from '@/hooks/use-locale';

/**
 * /integraciones — todas las apps externas y canales que se conectan a
 * la cuenta (WhatsApp, Meta, Google, Microsoft, Shopify). Antes vivía
 * como un tab dentro de /ajustes; ahora es su propia página para que
 * el onboarding ("conecta WhatsApp", "conecta Shopify") tenga un home
 * propio y no se mezcle con perfil / equipo.
 *
 * El componente `<ChannelsPanel/>` ya estaba escrito y maneja todos
 * los providers — sólo lo movemos de lugar.
 */
export default function IntegracionesPage() {
  const t = useT();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('settings.integrations')}</h1>
      </div>

      <ChannelsPanel />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            {t('settings.ownAudience')}
          </h2>
          <KlaviyoCard />
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            {t('settings.knowYourPeople')}
          </h2>
          <ApifyCard />
        </div>
      </div>
    </div>
  );
}
