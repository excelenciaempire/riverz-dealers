'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/** Confirmed message events refresh immediately. A lightweight wallet revision
 * catches credits, settlements and panel-only usage without a schema change. */
export function useWalletLive(
  workspaceId: string | undefined,
  onChange: () => void
) {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  useEffect(() => {
    if (!workspaceId) return;
    const db = createClient();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: string | null | undefined;
    let checking = false;
    const change = () => {
      if (document.visibilityState !== 'visible' || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        callback.current();
      }, 700);
    };
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const response = await fetch('/api/wallet/revision', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const next = (await response.json()).revision as string | null;
        if (controller.signal.aborted) return;
        if (revision !== undefined && next !== revision) change();
        revision = next;
      } catch {
        /* Full periodic refresh remains the recovery path. */
      } finally {
        checking = false;
      }
    };
    const channel = db
      .channel(`wallet-live:${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        change
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        change
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') change();
      });
    void check();
    const interval = setInterval(() => void check(), 3000);
    return () => {
      controller.abort();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, [workspaceId]);
}
