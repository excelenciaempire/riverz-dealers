'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ChannelsPanel } from '@/components/settings/channels-panel';
import { KlaviyoCard } from '@/components/settings/klaviyo-card';
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
        <Link
          href="/ajustes"
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          {t('settings.backToSettings')}
        </Link>
      </div>

      <ChannelsPanel />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          {t('settings.ownAudience')}
        </h2>
        <KlaviyoCard />
      </div>
    </div>
  );
}
