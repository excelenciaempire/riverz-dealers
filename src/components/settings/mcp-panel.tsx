'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Copy,
  Check,
  Loader2,
  Trash2,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { McpCodingSetup, McpOauthConnect } from './mcp-oauth-connect';

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scope: 'lectura' | 'total';
  created_at: string;
  last_used_at: string | null;
}

interface ActivityRow {
  id: number;
  actor: string;
  tool: string;
  risk: string;
  ok: boolean;
  summary: string | null;
  created_at: string;
}

/** Assistant installation first; credentials and code stay in manual setup. */
export function McpPanel() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();

  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'lectura' | 'total'>('lectura');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<'key' | 'config' | null>(null);
  const [verActividad, setVerActividad] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tk, ac] = await Promise.all([
        fetch('/api/mcp/tokens', { cache: 'no-store' }),
        fetch('/api/mcp/activity', { cache: 'no-store' }),
      ]);
      setTokens(tk.ok ? (((await tk.json()).tokens ?? []) as TokenRow[]) : []);
      setActivity(
        ac.ok ? (((await ac.json()).activity ?? []) as ActivityRow[]) : []
      );
    } catch {
      setTokens([]);
      setActivity([]);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetchWithCsrf('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scope }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(
          json?.error === 'too_many'
            ? t('settings.mcpTooMany')
            : t('settings.mcpCreateFailed')
        );
        return;
      }
      setFresh(json.token as string);
      setName('');
      void load();
    } catch {
      toast.error(t('settings.mcpCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      const res = await fetchWithCsrf(
        `/api/mcp/tokens?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) throw new Error('failed');
      toast.success(t('settings.mcpRevoked'));
      window.dispatchEvent(new Event('mcp-connections-changed'));
      void load();
    } catch {
      toast.error(t('settings.mcpRevokeFailed'));
    }
  };

  const copiar = async (texto: string, cual: 'key' | 'config') => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopied(cual);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error(t('oauth.copyFailed'));
    }
  };

  // El marcador sigue el idioma de la pantalla: uno fijo en español aparecía
  // dentro de la interfaz en inglés. Y cuando la llave se acaba de crear va
  // puesta de verdad, así que el bloque se copia y funciona sin editarlo.
  const configJson = `{
  "mcpServers": {
    "riverz": {
      "type": "http",
      "url": "https://riverz.co/api/mcp",
      "headers": { "Authorization": "Bearer ${fresh ?? t('settings.mcpKeyPlaceholder')}" }
    }
  }
}`;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4 space-y-0 sm:flex-row">
        <div>
          <CardTitle className="text-base">{t('settings.mcpTitle')}</CardTitle>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {t('settings.mcpDesc')}
          </p>
        </div>
        <a
          href="/documentacion"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-xs transition-colors"
        >
          {t('settings.mcpDocs')}
          <ExternalLink className="size-3" />
        </a>
      </CardHeader>

      <CardContent className="space-y-6">
        <McpOauthConnect />

        <details className="group/manual border-border border-t pt-4">
          <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open/manual:rotate-90" />
            {t('settings.mcpManual')}
          </summary>
          <div className="mt-5 space-y-6">
            <McpCodingSetup />

            {/* ── Paso 1 ─────────────────────────────────────────────── */}
            <Paso n={1} titulo={t('settings.mcpStep1')}>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('settings.mcpNamePlaceholder')}
                  maxLength={60}
                  aria-label={t('settings.mcpNamePlaceholder')}
                  className="w-full max-w-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create();
                  }}
                />
                <div className="border-border flex gap-1 rounded-md border p-0.5">
                  {(['lectura', 'total'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                        onClick={() => setScope(s)}
                        aria-pressed={scope === s}
                      className={cn(
                        'h-8 rounded px-2.5 text-xs transition-colors',
                        scope === s
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {t(
                        s === 'lectura'
                          ? 'settings.mcpScopeRead'
                          : 'settings.mcpScopeFull'
                      )}
                    </button>
                  ))}
                </div>
                <Button onClick={create} disabled={creating || !name.trim()}>
                  {creating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t('settings.mcpCreate')
                  )}
                </Button>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {t(
                  scope === 'lectura'
                    ? 'settings.mcpScopeReadHint'
                    : 'settings.mcpScopeFullHint'
                )}
              </p>

              {/* El valor recién creado. Se muestra una sola vez. */}
              {fresh && (
                <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    {t('settings.mcpCopyNow')}
                  </p>
                  <div className="flex gap-2">
                    <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 font-mono text-xs">
                      {fresh}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copiar(fresh, 'key')}
                    >
                      {copied === 'key' ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFresh(null)}
                    className="text-muted-foreground text-xs underline underline-offset-2"
                  >
                    {t('settings.mcpHideToken')}
                  </button>
                </div>
              )}

              {tokens && tokens.length > 0 ? (
                <ul className="divide-border border-border mt-3 divide-y rounded-lg border">
                  {tokens.map((tk) => (
                    <li
                      key={tk.id}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm">
                          {tk.name}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          <code>{tk.prefix}…</code>
                          {' · '}
                          {t(
                            tk.scope === 'lectura'
                              ? 'settings.mcpScopeRead'
                              : 'settings.mcpScopeFull'
                          )}
                          {' · '}
                          {tk.last_used_at
                            ? t('settings.mcpLastUsed', {
                                when: format.dateTime(tk.last_used_at),
                              })
                            : t('settings.mcpNeverUsed')}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revoke(tk.id)}
                        aria-label={t('settings.mcpRevoke')}
                        title={t('settings.mcpRevoke')}
                      >
                        <Trash2 className="text-muted-foreground size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                tokens && (
                  <p className="text-muted-foreground mt-3 text-xs">
                    {t('settings.mcpNoKeys')}
                  </p>
                )
              )}
            </Paso>

            {/* ── Paso 2 ─────────────────────────────────────────────── */}
            <Paso n={2} titulo={t('settings.mcpStep2')}>
              <div className="border-border bg-muted/40 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-foreground text-xs font-medium">
                    {t('settings.mcpHowTitle')}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copiar(configJson, 'config')}
                  >
                    {copied === 'config' ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
                <pre className="bg-background text-muted-foreground mt-2 overflow-x-auto rounded p-2 text-[11px] leading-relaxed">
                  {configJson}
                </pre>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {t('settings.mcpOauthNote')}
              </p>
            </Paso>
          </div>
        </details>

        {/* ── Actividad ──────────────────────────────────────────────
            Darle una llave a un programa y no poder ver qué hizo con ella es
            pedir confianza a cambio de nada. Va plegada porque se mira después
            de conectar, no mientras se conecta. */}
        {activity && activity.length > 0 && (
          <div className="border-border border-t pt-4">
            <button
              type="button"
              onClick={() => setVerActividad((v) => !v)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium transition-colors"
            >
              <ChevronRight
                className={cn(
                  'size-3.5 transition-transform',
                  verActividad && 'rotate-90'
                )}
              />
              {t('settings.mcpActivity')} ({activity.length})
            </button>
            {verActividad && (
              <ul className="divide-border border-border mt-2 divide-y rounded-lg border">
                {activity.slice(0, 10).map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        a.ok ? 'bg-emerald-500' : 'bg-red-500'
                      )}
                    />
                    <code className="text-foreground shrink-0">{a.tool}</code>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {a.summary}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {format.dateTime(a.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Un paso numerado. El número dice el orden sin que haya que explicarlo. */
function Paso({
  n,
  titulo,
  children,
}: {
  n: number;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="border-border text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">{titulo}</p>
        <div className="mt-2.5">{children}</div>
      </div>
    </div>
  );
}
