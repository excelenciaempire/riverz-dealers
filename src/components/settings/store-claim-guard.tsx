'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { useT } from '@/hooks/use-locale';
import { CLAIM_HINT_COOKIE } from '@/lib/shopify/claim-cookies';
import { TN_CLAIM_HINT_COOKIE } from '@/lib/commerce/tiendanube-claim-cookies';

/**
 * Ata al workspace las tiendas que se instalaron desde la plataforma antes
 * de que existiera la cuenta de Riverz.
 *
 * Las dos tiendas de aplicaciones —Shopify y Tiendanube— exigen que el
 * OAuth corra ANTES de cualquier login nuestro. El callback estaciona el
 * token cifrado y deja dos cookies: el token de reclamo (httpOnly, nunca
 * pasa por JS) y una pista legible con la tienda. En la primera carga del
 * panel con esa pista, esto llama al endpoint de reclamo y la tienda queda
 * atada. No renderiza nada.
 *
 * Una sola pieza para las dos plataformas: cambian el nombre de la cookie
 * y la ruta, y nada más.
 */
const PLATAFORMAS = [
  { hint: CLAIM_HINT_COOKIE, endpoint: '/api/shopify/claim' },
  { hint: TN_CLAIM_HINT_COOKIE, endpoint: '/api/tiendanube/claim' },
] as const;

export function StoreClaimGuard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const router = useLocalizedRouter();
  const t = useT();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const cookies = document.cookie.split('; ');
    const pendiente = PLATAFORMAS.find((p) =>
      cookies.some((c) => c.startsWith(`${p.hint}=`)),
    );
    if (!pendiente) return;

    void (async () => {
      try {
        const res = await fetchWithCsrf(pendiente.endpoint, { method: 'POST' });
        if (res.ok) {
          const data = (await res.json()) as { shop?: string };
          toast.success(t('settings.storeClaimed', { shop: data.shop ?? '' }));
          router.push('/integraciones');
          return;
        }
        // 404 = pista vieja (no hay nada pendiente) — el servidor ya borró
        // las cookies; callar. Cualquier otra cosa sí merece un aviso.
        if (res.status !== 404) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error) toast.error(data.error);
        }
      } catch {
        // Tropiezo de red: dejar las cookies y reintentar en la próxima carga.
        ran.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
