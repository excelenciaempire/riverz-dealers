'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

export function VoiceFallbackSettings({
  workspaceId,
  onSaved,
}: {
  workspaceId?: string;
  onSaved?: () => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [number, setNumber] = useState('');
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const response = await fetch(
      `/api/voice/connection?workspace_id=${workspaceId}`,
      { cache: 'no-store' }
    );
    if (response.ok) {
      const json = await response.json();
      setNumber(json.config?.fallback_transfer_number ?? '');
      setLanguage(json.config?.fallback_language === 'en' ? 'en' : 'es');
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const response = await fetchWithCsrf('/api/voice/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          config: {
            fallback_transfer_number: number.trim(),
            fallback_language: language,
          },
        }),
      });
      if (!response.ok) {
        toast.error(t('voice.fallbackInvalid'));
        return;
      }
      toast.success(t('voice.saved'));
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-border bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold">{t('voice.fallbackTitle')}</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {t('voice.fallbackDesc')}
      </p>
      {loading ? (
        <Loader2 className="mt-3 size-4 animate-spin" />
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="text-xs font-medium">
              {t('voice.fallbackNumber')}
            </span>
            <Input
              type="tel"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder={t('voice.testCallPlaceholder')}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">
              {t('voice.fallbackLanguage')}
            </span>
            <select
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value === 'en' ? 'en' : 'es')
              }
            >
              <option value="es">{t('voice.fallbackSpanish')}</option>
              <option value="en">{t('voice.fallbackEnglish')}</option>
            </select>
          </label>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t('voice.save')
            )}
          </Button>
        </div>
      )}
    </section>
  );
}
