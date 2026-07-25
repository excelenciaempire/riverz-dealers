'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Phone, Loader2, Search, Trash2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';

interface Current {
  phone_number: string | null;
  country: string | null;
  telnyx_number_id: string | null;
}
interface Available {
  phone_number: string;
  locality?: string | null;
  region?: string | null;
  monthly_cost?: string | null;
  currency?: string | null;
  features: string[];
}
interface Requirement {
  id: string;
  label: string;
  description?: string;
  field_type?: string;
}

const TYPES = [
  { value: 'local', key: 'voice.numberTypeLocal' },
  { value: 'toll_free', key: 'voice.numberTypeTollFree' },
  { value: 'mobile', key: 'voice.numberTypeMobile' },
  { value: 'national', key: 'voice.numberTypeNational' },
];

/** Self-serve phone number: search by country/type, buy, release. Each
 *  workspace provisions its own DID (caller ID + inbound target). */
export function VoiceNumberCard() {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [current, setCurrent] = useState<Current | null>(null);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState('CO');
  const [type, setType] = useState('local');
  const [results, setResults] = useState<Available[]>([]);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [requiresDocs, setRequiresDocs] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/voice/numbers?workspace_id=${workspace.id}`, {
        cache: 'no-store',
      });
      if (res.ok) setCurrent((await res.json()) as Current);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function search() {
    if (!workspace?.id || !country.trim()) return;
    setSearching(true);
    setSearched(true);
    setResults([]);
    try {
      const res = await fetch(
        `/api/voice/numbers/search?workspace_id=${workspace.id}&country=${country.trim().toUpperCase()}&type=${type}`,
        { cache: 'no-store' },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('voice.numberBuyError'));
        return;
      }
      setResults(json.numbers ?? []);
      setReqs(json.requirements ?? []);
      setRequiresDocs(!!json.requires_documents);
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSearching(false);
    }
  }

  async function buy(phone: string) {
    if (!workspace?.id) return;
    setBusy(phone);
    try {
      const res = await fetchWithCsrf('/api/voice/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          phone_number: phone,
          country: country.trim().toUpperCase(),
          type,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ? `${t('voice.numberBuyError')} (${json.error})` : t('voice.numberBuyError'));
        return;
      }
      toast.success(t('voice.numberBought'));
      setResults([]);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function release() {
    if (!workspace?.id || !window.confirm(t('voice.numberReleaseConfirm'))) return;
    setBusy('release');
    try {
      const res = await fetchWithCsrf(`/api/voice/numbers?workspace_id=${workspace.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(t('voice.numberReleased'));
        await load();
      } else {
        toast.error(t('voice.numberBuyError'));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Phone className="h-5 w-5 text-violet-500" />
        <p className="text-sm font-medium text-foreground">{t('voice.numberTitle')}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('voice.numberDesc')}</p>

      {loading ? (
        <div className="mt-3 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : current?.phone_number ? (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            {current.phone_number}
            {current.country && (
              <span className="text-xs text-muted-foreground">· {current.country}</span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={release} disabled={busy === 'release'}>
            {busy === 'release' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('voice.numberCountry')}
              </span>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                placeholder="CO"
                maxLength={2}
                className="w-20"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('voice.numberType')}
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                {TYPES.map((ty) => (
                  <option key={ty.value} value={ty.value}>
                    {t(ty.key)}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={search} disabled={searching || !country.trim()}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Search className="mr-1 h-4 w-4" />
                  {t('voice.numberSearch')}
                </>
              )}
            </Button>
          </div>

          {/* Regulatory requirements for gated countries */}
          {requiresDocs && reqs.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-3.5 w-3.5" />
                {t('voice.numberDocsRequired')}
              </p>
              <ul className="mt-1.5 list-disc pl-5 text-foreground/90">
                {reqs.map((r) => (
                  <li key={r.id}>{r.label}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-muted-foreground">{t('voice.numberDocsHint')}</p>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <ul className="divide-y divide-border/60 rounded-lg border border-border">
              {results.map((n) => (
                <li key={n.phone_number} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-foreground">
                    {n.phone_number}
                    {n.locality && (
                      <span className="ml-2 text-xs text-muted-foreground">{n.locality}</span>
                    )}
                    {n.monthly_cost && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {n.currency ? `${n.currency} ` : '$'}
                        {n.monthly_cost}
                        {t('voice.numberPerMonth')}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => buy(n.phone_number)}
                    disabled={!!busy || requiresDocs}
                  >
                    {busy === n.phone_number ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('voice.numberBuy')
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {searched && !searching && results.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('voice.numberNoResults')}</p>
          )}
        </div>
      )}
    </div>
  );
}
