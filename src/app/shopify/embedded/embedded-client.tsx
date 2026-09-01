'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { signupsOpen } from '@/lib/auth/signups';

declare global {
  interface Window {
    shopify?: { idToken?: () => Promise<string> };
  }
}

type Status =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; shop: string; state: 'connected' | 'pending' | 'none' };

/**
 * Client half of the embedded Shopify admin page. Waits for App Bridge
 * to expose `shopify.idToken()`, exchanges that session token for the
 * shop's connection state, and renders one action:
 *
 *   connected → open the Riverz inbox (new tab)
 *   pending   → finish linking a Riverz account (new tab, claim cookie
 *               is already in this browser from the OAuth redirect)
 *   none      → run OAuth for this shop (new tab)
 *
 * Everything opens in a new tab: Riverz is a full standalone app and
 * OAuth/login can't run inside the admin iframe.
 */
export function EmbeddedClient() {
  const t = useT();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const waitForAppBridge = async (): Promise<string | null> => {
      for (let i = 0; i < 50; i++) {
        const idToken = window.shopify?.idToken;
        if (idToken) return idToken();
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    };

    void (async () => {
      try {
        const token = await waitForAppBridge();
        if (cancelled) return;
        if (!token) {
          setStatus({ kind: 'error' });
          return;
        }
        const res = await fetch('/api/shopify/embedded/status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          setStatus({ kind: 'error' });
          return;
        }
        const data = (await res.json()) as {
          shop: string;
          state: 'connected' | 'pending' | 'none';
        };
        setStatus({ kind: 'ready', shop: data.shop, state: data.state });
      } catch {
        if (!cancelled) setStatus({ kind: 'error' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center">
        <span className="text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink">
          riverz
        </span>

        {status.kind === 'loading' && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}

        {status.kind === 'error' && (
          <p className="text-sm text-muted-foreground">
            {t('settings.shopifyEmbeddedError')}
          </p>
        )}

        {status.kind === 'ready' && status.state === 'connected' && (
          <>
            <p className="flex items-center gap-2 text-sm text-foreground">
              <CheckCircle2 className="h-4 w-4 text-accent-ink" />
              {t('settings.shopifyEmbeddedConnected')}
            </p>
            <a
              href="/bandeja"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('settings.shopifyEmbeddedOpen')}
            </a>
          </>
        )}

        {status.kind === 'ready' && status.state !== 'connected' && (
          <>
            <p className="text-sm text-muted-foreground">
              {t('settings.shopifyEmbeddedPending')}
            </p>
            <a
              href={
                status.state === 'pending'
                  ? // Pre-launch: /crear is closed; sign in and the
                    // dashboard claims the parked install.
                    signupsOpen()
                    ? `/crear?shopify=pending&shop=${encodeURIComponent(status.shop)}`
                    : `/ingresar?shopify=pending&shop=${encodeURIComponent(status.shop)}`
                  : `/api/shopify/oauth/start?shop=${encodeURIComponent(status.shop)}`
              }
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('settings.shopifyEmbeddedFinish')}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
