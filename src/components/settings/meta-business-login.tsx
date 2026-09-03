'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { ChannelLogo } from '@/components/inbox/channel-logo';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Facebook Login for Business launcher for Messenger / Instagram. Uses the
 * JS SDK FB.login with our login config_id — Facebook accepts config_id
 * through FB.login but REJECTS it on the bare server-side dialog/oauth
 * redirect ("config_id is required"), which is why the old redirect flow
 * failed. Mirrors the working WhatsApp Embedded Signup.
 *
 * Requires NEXT_PUBLIC_META_APP_ID + NEXT_PUBLIC_META_LOGIN_CONFIG_ID.
 */

declare global {
  interface Window {
    FB?: {
      init: (params: Record<string, unknown>) => void;
      login: (
        cb: (resp: {
          authResponse?: { code?: string };
          status?: string;
        }) => void,
        opts: Record<string, unknown>
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID;

export function MetaBusinessLogin({
  workspaceId,
  channel,
  anyConnected,
  reconnectAccountIds = [],
  logoChannel,
  logoSrc,
  onConnected,
}: {
  workspaceId: string;
  /** "messenger" (Facebook card) or "instagram". */
  channel: 'messenger' | 'instagram';
  anyConnected: boolean;
  /** Accounts already associated with this Riverz workspace that only need
   * fresh Meta consent. They must never be replaced by other accounts the
   * same Facebook user can manage. */
  reconnectAccountIds?: string[];
  logoChannel: 'messenger' | 'instagram';
  /** El logo de la tarjeta, cuando no es el del canal interno. */
  logoSrc?: string;
  onConnected: () => void;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();

  // Held between the discovery (list_only) call and the persist call so the
  // picker can connect the chosen accounts without re-running FB.login.
  const [cred, setCred] = useState<{
    access_token?: string;
    code?: string;
  } | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [adAccounts, setAdAccounts] = useState<{ id: string; label: string }[]>(
    []
  );
  const [adAccountsByPage, setAdAccountsByPage] = useState<
    Record<string, Set<string>>
  >({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    // Chain (don't clobber) fbAsyncInit so multiple instances on the page
    // (Facebook + Instagram cards) each init. Then POLL window.FB as a
    // fallback: whichever instance's fbAsyncInit was last set wins the
    // callback, so without this the other instance's button would stay
    // permanently disabled.
    const prev = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      prev?.();
      try {
        // v25.0 — DEBE coincidir con la versión que usa whatsapp-embedded-signup.
        // Ambos componentes se renderizan en la misma página de Canales y
        // COMPARTEN el mismo script del SDK (id="facebook-jssdk"). FB.init solo
        // aplica una vez: el que carga primero fija la versión para todos. Si
        // este quedaba en v22, el popup de WhatsApp salía en v22 aunque su
        // propio init pidiera v25 → la coexistencia no se activaba.
        window.FB?.init({
          appId: APP_ID,
          autoLogAppEvents: true,
          xfbml: false,
          version: 'v25.0',
        });
      } catch {
        /* init is idempotent; ignore double-init */
      }
      setSdkReady(true);
    };
    const id = 'facebook-jssdk';
    if (!document.getElementById(id)) {
      const js = document.createElement('script');
      js.id = id;
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      js.async = true;
      js.defer = true;
      document.body.appendChild(js);
    }
    const poll = setInterval(() => {
      if (window.FB) {
        setSdkReady(true);
        clearInterval(poll);
      }
    }, 300);
    return () => clearInterval(poll);
  }, []);

  // Persist the chosen accounts. `pageIds` empty/absent = let the server
  // decide (single-account fast path passes the one id explicitly).
  const persist = useCallback(
    async (
      payload: { access_token?: string; code?: string },
      pageIds: string[]
    ) => {
      setBusy(true);
      try {
        const r = await fetchWithCsrf('/api/connections/meta/sdk-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            channel,
            workspace_id: workspaceId,
            page_ids: pageIds,
            ad_account_ids_by_page:
              channel === 'messenger' && reconnectAccountIds.length === 0
                ? Object.fromEntries(
                    pageIds.map((pageId) => [
                      pageId,
                      [...(adAccountsByPage[pageId] ?? [])],
                    ])
                  )
                : undefined,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast.error(j.error || t('settings.metaConnectError'));
          return;
        }
        toast.success(t('settings.metaConnectedAccounts', { n: j.saved ?? 0 }));
        setPickerOpen(false);
        setCred(null);
        onConnected();
      } catch (err) {
        toast.error(t('settings.networkError'));
      } finally {
        setBusy(false);
      }
    },
    [
      workspaceId,
      channel,
      onConnected,
      fetchWithCsrf,
      t,
      adAccountsByPage,
      reconnectAccountIds,
    ]
  );

  // Step 1: discover the accounts the token can manage (no persistence).
  // 0 → error · 1 → connect it directly · >1 → open the picker.
  const discover = useCallback(
    async (payload: { access_token?: string; code?: string }) => {
      setBusy(true);
      try {
        const r = await fetchWithCsrf('/api/connections/meta/sdk-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            channel,
            workspace_id: workspaceId,
            list_only: true,
          }),
        });
        const j = (await r.json().catch(() => ({}))) as {
          accounts?: { id: string; label: string }[];
          adAccounts?: { id: string; label: string }[];
          error?: string;
        };
        if (!r.ok) {
          toast.error(j.error || t('settings.metaConnectError'));
          return;
        }
        const found = j.accounts ?? [];
        if (found.length === 0) {
          toast.error(
            t(
              channel === 'messenger'
                ? 'settings.noFacebookPagesFound'
                : 'settings.noInstagramAccountsFound'
            )
          );
          return;
        }
        const reconnecting = new Set(reconnectAccountIds.map(String));
        if (reconnecting.size > 0) {
          const known = found.filter((account) => reconnecting.has(account.id));
          // A reauthorization is intentionally one step: Meta's official
          // consent screen is enough when this workspace's known account is
          // still available. The internal picker is only for adding accounts.
          if (known.length === reconnecting.size) {
            await persist(
              payload,
              known.map((account) => account.id)
            );
            return;
          }
          toast.error(t('settings.metaReconnectAccountUnavailable'));
          return;
        }
        if (found.length === 1 && channel !== 'messenger') {
          await persist(payload, [found[0].id]);
          return;
        }
        setCred(payload);
        setAccounts(found);
        setAdAccounts(j.adAccounts ?? []);
        setAdAccountsByPage(
          Object.fromEntries(
            found.map((account) => [account.id, new Set<string>()])
          )
        );
        // Meta can list every Page managed by one profile. New connections
        // start unselected so a workspace never receives assets by accident.
        setChecked(new Set());
        setPickerOpen(true);
      } catch (err) {
        toast.error(t('settings.networkError'));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, channel, fetchWithCsrf, persist, t, reconnectAccountIds]
  );

  const launch = useCallback(() => {
    if (!window.FB || !CONFIG_ID) return;
    // Config de identificador de USUARIO → FB.login devuelve el token de
    // acceso directo en authResponse.accessToken (sin code-exchange, así no
    // hay redirect_uri que cuadrar — el code-exchange del SDK daba 400
    // error_subcode 36008). Si por config llegara un `code`, lo mandamos
    // igual y el server hace el canje como fallback.
    window.FB.login(
      (resp) => {
        // El tipo global de FB.login (compartido con WhatsApp ES) solo
        // declara `code`; en el flujo de token también viene accessToken.
        const ar = resp.authResponse as
          | { code?: string; accessToken?: string }
          | undefined;
        const token = ar?.accessToken;
        const code = ar?.code;
        if (token) void discover({ access_token: token });
        else if (code) void discover({ code });
        else toast.error(t('settings.metaConnectionCancelled'));
      },
      { config_id: CONFIG_ID }
    );
  }, [discover, t]);

  if (!APP_ID || !CONFIG_ID) return null;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAdAccount = (pageId: string, adAccountId: string) => {
    setAdAccountsByPage((previous) => {
      const next = { ...previous };
      const selected = new Set(next[pageId] ?? []);
      if (selected.has(adAccountId)) selected.delete(adAccountId);
      else selected.add(adAccountId);
      next[pageId] = selected;
      return next;
    });
  };

  return (
    <>
      <button
        onClick={launch}
        disabled={!sdkReady || busy}
        className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ChannelLogo channel={logoChannel} src={logoSrc} size={16} />
        )}
        {t(
          channel === 'messenger'
            ? reconnectAccountIds.length > 0
              ? 'settings.reauthorizeFacebook'
              : anyConnected
                ? 'settings.addAnotherFacebookPage'
                : 'settings.connectFacebookPage'
            : reconnectAccountIds.length > 0
              ? 'settings.reauthorizeInstagram'
              : anyConnected
                ? 'settings.addAnotherInstagramAccount'
                : 'settings.connectInstagramAccount'
        )}
      </button>

      <Dialog
        open={pickerOpen}
        onOpenChange={(o) => {
          // Don't drop the held credential mid-request; only reset on close.
          setPickerOpen(o);
          if (!o) setCred(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t(
                channel === 'messenger'
                  ? 'settings.chooseFacebookPagesToConnect'
                  : 'settings.chooseInstagramAccountsToConnect'
              )}
            </DialogTitle>
          </DialogHeader>

          <p className="text-muted-foreground text-sm">
            {t('settings.metaPickerWorkspaceScope')}
          </p>

          <ul className="-mx-1 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {accounts.map((a) => (
              <li key={a.id}>
                <label className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={checked.has(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <span className="flex items-center gap-2 text-sm">
                    <ChannelLogo
                      channel={logoChannel}
                      src={logoSrc}
                      size={16}
                    />
                    {channel === 'instagram'
                      ? a.label.replace(/\s+\(Instagram\)$/u, '')
                      : a.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {channel === 'messenger' && (
            <div className="max-h-48 space-y-3 overflow-y-auto border-t pt-3">
              <p className="text-foreground text-sm font-medium">
                {t('settings.chooseFacebookAdAccounts')}
              </p>
              {adAccounts.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t('settings.noFacebookAdAccountsFound')}
                </p>
              ) : (
                accounts
                  .filter((account) => checked.has(account.id))
                  .map((page) => (
                    <div key={page.id} className="space-y-1">
                      <p className="text-muted-foreground px-3 text-xs">
                        {page.label}
                      </p>
                      {adAccounts.map((adAccount) => (
                        <label
                          key={adAccount.id}
                          className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5"
                        >
                          <input
                            type="checkbox"
                            className="accent-primary size-4"
                            checked={
                              adAccountsByPage[page.id]?.has(adAccount.id) ??
                              false
                            }
                            onChange={() =>
                              toggleAdAccount(page.id, adAccount.id)
                            }
                          />
                          <span className="text-sm">{adAccount.label}</span>
                        </label>
                      ))}
                    </div>
                  ))
              )}
            </div>
          )}

          <DialogFooter showCloseButton>
            <Button
              onClick={() => cred && void persist(cred, [...checked])}
              disabled={busy || checked.size === 0}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('settings.connectSelected', { n: checked.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
