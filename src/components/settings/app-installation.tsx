'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/hooks/use-locale';
import { installationController } from '@/lib/pwa/installation';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';

/** Capture early in the dashboard, including while settings is not open. */
export function AppInstallationCapture() {
  useEffect(() => {
    if (SHOW_RIVERZ_IMPROVEMENTS) return installationController.attach(window);
  }, []);
  return null;
}

export function AppInstallation() {
  const t = useT();
  const state = useSyncExternalStore(installationController.subscribe, installationController.getSnapshot, installationController.getServerSnapshot);
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  const message = {
    manual: state.ios ? 'settings.installIos' : 'settings.installBrowser',
    available: 'settings.installReady',
    prompting: 'settings.installPrompting',
    accepted: 'settings.installAccepted',
    dismissed: 'settings.installDismissed',
    failed: 'settings.installFailed',
    installed: 'settings.installInstalled',
  } as const;
  return <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Smartphone className="size-5" aria-hidden="true" />{t('settings.installTitle')}</h2>
    <p className="mt-2 text-sm text-muted-foreground">{t('settings.installBody')}</p>
    <p className="mt-3 text-sm" role={state.status === 'failed' ? 'alert' : 'status'}>{t(message[state.status])}</p>
    {(state.status === 'available' || state.status === 'prompting') && <Button className="mt-4" disabled={state.status === 'prompting'} onClick={() => void installationController.prompt()}>{t('settings.installButton')}</Button>}
    {state.status !== 'installed' && state.status !== 'manual' && <p className="mt-3 text-xs text-muted-foreground">{t(state.ios ? 'settings.installIos' : 'settings.installBrowser')}</p>}
    <p className="mt-3 text-xs text-muted-foreground">{t('settings.installConnection')}</p>
  </section>;
}
