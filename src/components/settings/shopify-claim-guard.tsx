'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { useT } from '@/hooks/use-locale';
import { CLAIM_HINT_COOKIE } from '@/lib/shopify/claim-cookies';

/**
 * Auto-claims a pending Shopify install right after sign-in/up.
 *
 * The OAuth callback (App Store flow: merchant installed from Shopify
 * admin with no Riverz account) parked the store and left a JS-readable
 * hint cookie with the shop domain. On the first dashboard load with
 * that hint present, POST /api/shopify/claim binds the store to the
 * merchant's workspace — the secret claim token travels in its own
 * httpOnly cookie, never through JS. Renders nothing.
 */
export function ShopifyClaimGuard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const router = useLocalizedRouter();
  const t = useT();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hint = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${CLAIM_HINT_COOKIE}=`));
    if (!hint) return;

    void (async () => {
      try {
        const res = await fetchWithCsrf('/api/shopify/claim', { method: 'POST' });
        if (res.ok) {
          const data = (await res.json()) as { shop?: string };
          toast.success(
            t('settings.shopifyStoreClaimed', { shop: data.shop ?? '' }),
          );
          router.push('/integraciones');
          return;
        }
        // 404 = stale hint (nothing pending) — the server already cleared
        // the cookies; stay silent. Anything else is worth a toast.
        if (res.status !== 404) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error) toast.error(data.error);
        }
      } catch {
        // Network hiccup: leave the cookies in place; next load retries.
        ran.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
