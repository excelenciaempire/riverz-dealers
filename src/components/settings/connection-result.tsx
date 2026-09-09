'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';

/**
 * Qué pasó al volver de autorizar una cuenta.
 *
 * Todas las conexiones salen del sitio, piden permiso en la otra plataforma
 * y vuelven a /integraciones con el resultado en la URL. Nadie lo leía: se
 * conectara o fallara, la pantalla quedaba exactamente igual. Una conexión
 * que falla en silencio es peor que una que falla fuerte — el comerciante se
 * queda creyendo que quedó lista y se entera semanas después, cuando nota
 * que no le llega nada.
 *
 * Se muestra el resultado y se limpia la URL, para que recargar no repita el
 * aviso ni deje un parámetro pegado en la barra.
 */
export function ConnectionResult() {
  const params = useSearchParams();
  const t = useT();
  // En desarrollo el efecto corre dos veces; sin esto el aviso sale doble.
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    const oauth = params.get('oauth');
    const mp = params.get('mercadopago');
    if (!oauth && !mp) return;
    shown.current = true;

    if (oauth === 'ok') {
      toast.success(t('settings.connectResultOk'));
    } else if (oauth === 'error') {
      const detail = params.get('detail');
      toast.error(t('settings.connectResultError'), {
        description: connectionErrorDetail(detail, t),
      });
    }

    if (mp === 'conectado') {
      toast.success(t('settings.mpConnected'));
    } else if (mp === 'cancelado') {
      toast.info(t('settings.connectResultCancelled'));
    } else if (mp === 'reintentar') {
      toast.error(t('settings.connectResultRetry'));
    } else if (mp) {
      toast.error(t('settings.connectResultError'), {
        description: params.get('detalle') ?? undefined,
      });
    }

    const url = new URL(window.location.href);
    for (const k of ['oauth', 'detail', 'mercadopago', 'detalle']) {
      url.searchParams.delete(k);
    }
    window.history.replaceState({}, '', url.pathname + url.search);
  }, [params, t]);

  return null;
}

function connectionErrorDetail(
  detail: string | null,
  t: (key: string) => string,
): string {
  if (detail?.includes('channel_connections_channel_check')) return t('settings.zohoSchemaUnavailable');
  if (detail === 'zoho_mailbox_required') return t('settings.zohoMailboxRequired');
  if (detail === 'zoho_inbox_required') return t('settings.zohoInboxRequired');
  if (detail === 'zoho_authorization_denied') return t('settings.zohoAuthorizationDenied');
  if (detail === 'zoho_authorization_expired') return t('settings.zohoAuthorizationExpired');
  if (detail === 'zoho_token_exchange_failed') return t('settings.zohoTokenExchangeFailed');
  if (detail === 'mailbox_address_unavailable') return t('settings.mailboxAddressUnavailable');
  return t('settings.connectResultErrorDetail');
}
