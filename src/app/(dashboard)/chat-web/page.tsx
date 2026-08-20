'use client';

import { WebchatPanel } from '@/components/settings/webchat-panel';
import { useT } from '@/hooks/use-locale';

export default function WebchatPage() {
  const t = useT();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('webchat.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('webchat.subtitle')}</p>
      </div>
      <WebchatPanel />
    </div>
  );
}
