'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  Send,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

type Endpoint = {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
};

export function WebhooksCard() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [items, setItems] = useState<Endpoint[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [chosen, setChosen] = useState<string[]>(['conversation.created']);
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations/webhooks', {
        cache: 'no-store',
      });
      const json = await response.json();
      if (response.ok) {
        setItems(json.endpoints ?? []);
        setEvents(json.events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [modalOpen]);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success(t('settings.webhookCopied'));
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetchWithCsrf('/api/integrations/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, url, events: chosen }),
      });
      const json = await response.json();
      if (!response.ok) {
        toast.error(t('settings.webhookInvalid'));
        return;
      }
      setSecret(json.secret);
      setName('');
      setUrl('');
      setFormOpen(false);
      await load();
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const response = await fetchWithCsrf(
      `/api/integrations/webhooks?id=${id}`,
      { method: 'DELETE' }
    );
    if (response.ok) {
      setItems((current) => current.filter((item) => item.id !== id));
      toast.success(t('settings.webhookDeleted'));
    }
  }

  async function test(id: string) {
    const response = await fetchWithCsrf(
      `/api/integrations/webhooks/${id}/test`,
      { method: 'POST' }
    );
    toast[response.ok ? 'success' : 'error'](
      response.ok ? t('settings.webhookTestSent') : t('settings.genericError')
    );
  }

  const connected = items.length > 0;

  return (
    <>
      <li
        className={cn(
          'group bg-card flex flex-col gap-3 overflow-hidden rounded-xl border p-4 transition-all',
          connected
            ? 'border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]'
            : 'border-border hover:border-foreground/30'
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700 ring-1 ring-violet-500/15 dark:text-violet-300">
            <Webhook className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-semibold">
              {t('settings.webhooksTitle')}
            </p>
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-snug">
              {t('settings.webhooksDescription')}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          </div>
        ) : connected ? (
          <div className="bg-muted/60 ring-border/50 flex items-center gap-2 rounded-md px-2 py-1.5 ring-1">
            <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-400" />
            <span className="text-foreground truncate text-xs">
              {t('settings.webhookConnectedCount', { count: items.length })}
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setModalOpen(true);
            if (!connected) setFormOpen(true);
          }}
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-auto flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
        >
          <Webhook className="size-4" />
          {connected
            ? t('settings.webhookManage')
            : t('settings.webhookConfigure')}
        </button>
      </li>

      {modalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="webhooks-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setModalOpen(false);
            }}
          >
            <div className="bg-card border-border max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border shadow-2xl">
              <div className="border-border bg-card sticky top-0 z-10 flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h2 id="webhooks-title" className="text-base font-semibold">
                    {t('settings.webhooksTitle')}
                  </h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t('settings.webhookModalDescription')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-2"
                  aria-label={t('common.close')}
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setFormOpen((current) => !current)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium"
                  >
                    <Plus className="size-4" />
                    {t('settings.webhookNew')}
                  </button>
                </div>

                {formOpen && (
                  <div className="border-border bg-muted/30 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
                    <label className="space-y-1 text-xs font-medium">
                      {t('settings.webhookName')}
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Make"
                        className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border px-3 py-2 text-sm font-normal outline-none"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium">
                      {t('settings.webhookUrl')}
                      <input
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://hooks.make.com/..."
                        className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border px-3 py-2 text-sm font-normal outline-none"
                      />
                    </label>
                    <fieldset className="sm:col-span-2">
                      <legend className="mb-2 text-xs font-medium">
                        {t('settings.webhookEventsLabel')}
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {events.map((event) => (
                          <label
                            key={event}
                            className="text-foreground flex items-center gap-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={chosen.includes(event)}
                              onChange={() =>
                                setChosen((current) =>
                                  current.includes(event)
                                    ? current.filter((value) => value !== event)
                                    : [...current, event]
                                )
                              }
                            />
                            {event}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={save}
                        disabled={saving}
                        className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
                      >
                        {saving ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          t('settings.save')
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {secret && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
                    <p className="font-medium">
                      {t('settings.webhookSecretTitle')}
                    </p>
                    <p className="text-muted-foreground mt-1">
                      {t('settings.webhookSecretDescription')}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="bg-background min-w-0 flex-1 truncate rounded-lg p-2">
                        {secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy(secret)}
                        className="hover:bg-muted rounded-lg p-2"
                        aria-label={t('settings.copy')}
                      >
                        <Copy className="size-4" />
                      </button>
                    </div>
                  </div>
                )}

                {!loading && items.length === 0 && !formOpen ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {t('settings.webhookEmpty')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((item) => (
                      <li
                        key={item.id}
                        className="border-border flex flex-wrap items-center gap-2 rounded-xl border px-3 py-3 text-xs"
                      >
                        <CheckCircle2 className="size-4 text-emerald-600" />
                        <span className="font-medium">{item.name}</span>
                        <code className="text-muted-foreground min-w-0 flex-1 truncate">
                          {item.url}
                        </code>
                        <span className="text-muted-foreground">
                          {item.events.length} {t('settings.webhookEvents')}
                        </span>
                        <button
                          type="button"
                          onClick={() => test(item.id)}
                          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-2"
                          aria-label={t('settings.webhookSendTest')}
                          title={t('settings.webhookSendTest')}
                        >
                          <Send className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(item.id)}
                          className="text-muted-foreground hover:bg-muted hover:text-destructive rounded-lg p-2"
                          aria-label={t('settings.delete')}
                          title={t('settings.delete')}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
