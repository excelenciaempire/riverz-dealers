'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';

/**
 * Conectar Klaviyo (por workspace) para el sync de leads capturados por el
 * Agente de Instagram. La key se guarda encriptada y nunca vuelve al cliente.
 */
export function KlaviyoCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const [connected, setConnected] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/klaviyo', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setConnected(!!json.connected);
    } catch {
      /* no-op */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (apiKey.trim().length < 10) {
      toast.error('Pega una API key válida de Klaviyo.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/klaviyo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo conectar Klaviyo');
        return;
      }
      setConnected(true);
      setApiKey('');
      toast.success('Klaviyo conectado');
    } catch {
      toast.error('Error de red');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/klaviyo', {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error('No se pudo desconectar');
        return;
      }
      setConnected(false);
      toast.success('Klaviyo desconectado');
    } catch {
      toast.error('Error de red');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Klaviyo</p>
          <p className="text-xs text-muted-foreground">
            Sincroniza los leads que captura el Agente de Instagram a tu lista de
            email/SMS.
          </p>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" />
            Conectado
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : connected ? (
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Reemplazar API key…"
            className="max-w-xs"
          />
          <Button onClick={save} disabled={saving} variant="secondary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Actualizar'}
          </Button>
          <Button
            onClick={disconnect}
            disabled={saving}
            variant="ghost"
            aria-label="Desconectar Klaviyo"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Klaviyo Private API key (pk_…)"
            className="max-w-xs"
          />
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Conectar'}
          </Button>
        </div>
      )}
    </div>
  );
}
