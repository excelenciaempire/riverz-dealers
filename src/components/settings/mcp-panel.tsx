'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Check, Loader2, Trash2, KeyRound } from 'lucide-react';

import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Conectar tu propio agente a Riverz.
 *
 * Riverz habla MCP: con una de estas llaves, cualquier asistente que soporte el
 * protocolo —Claude, un flujo de n8n, algo propio— puede preguntarle a la
 * operación de este comercio y actuar sobre ella. La llave lleva la cuenta
 * adentro, así que nunca alcanza a otra: el servidor no le cree al agente
 * cuando nombra un workspace, usa el de la llave.
 *
 * El valor se muestra una sola vez. No es una molestia de diseño: en la base
 * vive el hash, así que ni Riverz puede volver a mostrarlo.
 */
export function McpPanel() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();

  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/tokens', { cache: 'no-store' });
      if (res.ok) setTokens(((await res.json()).tokens ?? []) as TokenRow[]);
      else setTokens([]);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetchWithCsrf('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(
          json?.error === 'too_many'
            ? t('settings.mcpTooMany')
            : t('settings.mcpCreateFailed'),
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
      const res = await fetchWithCsrf(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('failed');
      toast.success(t('settings.mcpRevoked'));
      void load();
    } catch {
      toast.error(t('settings.mcpRevokeFailed'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-muted-foreground" />
          {t('settings.mcpTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">{t('settings.mcpDesc')}</p>

        {/* El valor recién creado. Se muestra una sola vez. */}
        {fresh && (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {t('settings.mcpCopyNow')}
            </p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
                {fresh}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(fresh);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <button
              onClick={() => setFresh(null)}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t('settings.mcpHideToken')}
            </button>
          </div>
        )}

        {/* Crear */}
        <div className="flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.mcpNamePlaceholder')}
            maxLength={60}
            className="max-w-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
          <Button onClick={create} disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : t('settings.mcpCreate')}
          </Button>
        </div>

        {/* Las que hay */}
        {tokens && tokens.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {tokens.map((tk) => (
              <li key={tk.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{tk.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{tk.prefix}…</code>
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
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Cómo se conecta. Sin esto la llave es un string sin destino. */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">{t('settings.mcpHowTitle')}</p>
          <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
{`{
  "mcpServers": {
    "riverz": {
      "url": "https://riverz.co/api/mcp",
      "headers": { "Authorization": "Bearer TU_LLAVE" }
    }
  }
}`}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
