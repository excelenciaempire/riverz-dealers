'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Phone, Loader2, Search, Trash2, Check, AlertCircle, Upload } from 'lucide-react';
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
  monthly_cost?: string | null;
  currency?: string | null;
}
interface Requirement {
  id: string;
  label: string;
  description?: string;
  example?: string;
  field_type: string; // textual | datetime | document | address
}
interface Regulatory {
  requirement_group_id: string | null;
  status: string | null; // approved | pending-approval | declined | ...
}

const TYPES = [
  { value: 'local', key: 'voice.numberTypeLocal' },
  { value: 'toll_free', key: 'voice.numberTypeTollFree' },
  { value: 'mobile', key: 'voice.numberTypeMobile' },
  { value: 'national', key: 'voice.numberTypeNational' },
];

/** Self-serve phone number per workspace: search by country/type, upload the
 *  country's regulatory documentation when required, buy, release. */
export function VoiceNumberCard() {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [current, setCurrent] = useState<Current | null>(null);
  const [regulatory, setRegulatory] = useState<Regulatory | null>(null);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState('CO');
  const [type, setType] = useState('local');
  const [results, setResults] = useState<Available[]>([]);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [requiresDocs, setRequiresDocs] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Regulatory form state
  const [reqValues, setReqValues] = useState<Record<string, string>>({});
  const [addr, setAddr] = useState<Record<string, Record<string, string>>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const [numRes, regRes] = await Promise.all([
        fetch(`/api/voice/numbers?workspace_id=${workspace.id}`, { cache: 'no-store' }),
        fetch(`/api/voice/numbers/regulatory?workspace_id=${workspace.id}`, { cache: 'no-store' }),
      ]);
      if (numRes.ok) setCurrent((await numRes.json()) as Current);
      if (regRes.ok) setRegulatory((await regRes.json()) as Regulatory);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const approved = regulatory?.status === 'approved';
  const pending =
    !!regulatory?.requirement_group_id && !approved && regulatory?.status !== 'declined';

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

  async function uploadDoc(reqId: string, file: File) {
    if (!workspace?.id) return;
    setUploading(reqId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('workspace_id', workspace.id);
      const res = await fetchWithCsrf('/api/voice/numbers/documents', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.document_id) {
        setReqValues((v) => ({ ...v, [reqId]: json.document_id }));
      } else {
        toast.error(t('voice.numberRegError'));
      }
    } finally {
      setUploading(null);
    }
  }

  async function saveAddress(reqId: string) {
    if (!workspace?.id) return;
    const a = addr[reqId] || {};
    setUploading(reqId);
    try {
      const res = await fetchWithCsrf('/api/voice/numbers/address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          business_name: a.business,
          street_address: a.street,
          locality: a.city,
          administrative_area: a.state,
          postal_code: a.postal,
          country_code: country.trim().toUpperCase(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.address_id) {
        setReqValues((v) => ({ ...v, [reqId]: json.address_id }));
        toast.success(t('voice.numberAddrSaved'));
      } else {
        toast.error(t('voice.numberRegError'));
      }
    } finally {
      setUploading(null);
    }
  }

  const allFilled = reqs.length > 0 && reqs.every((r) => !!reqValues[r.id]);

  async function submitReg() {
    if (!workspace?.id || !allFilled) return;
    setSubmitting(true);
    try {
      const res = await fetchWithCsrf('/api/voice/numbers/regulatory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          country: country.trim().toUpperCase(),
          type,
          requirements: reqs.map((r) => ({ requirement_id: r.id, field_value: reqValues[r.id] })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setRegulatory({ requirement_group_id: json.requirement_group_id, status: json.status });
      } else {
        toast.error(json.error ? `${t('voice.numberRegError')} (${json.error})` : t('voice.numberRegError'));
      }
    } finally {
      setSubmitting(false);
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
          requirement_group_id: requiresDocs ? regulatory?.requirement_group_id : undefined,
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

  const buyDisabled = (phone: string) =>
    !!busy || (requiresDocs && !approved) || busy === phone;

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

          {/* Regulatory: approved / pending banners */}
          {requiresDocs && approved && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5" />
              {t('voice.numberRegStatusApproved')} · {t('voice.numberRegApprovedHint')}
            </div>
          )}
          {requiresDocs && pending && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('voice.numberRegStatusPending')} · {t('voice.numberRegPendingHint')}
            </div>
          )}

          {/* Regulatory: the requirements form (until submitted/approved) */}
          {requiresDocs && !approved && !pending && reqs.length > 0 && (
            <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-3.5 w-3.5" />
                {t('voice.numberDocsRequired')}
              </p>
              {reqs.map((r) => (
                <div key={r.id} className="rounded-md border border-border/60 bg-background p-2.5">
                  <p className="text-xs font-medium text-foreground">{r.label}</p>
                  {r.description && (
                    <p className="mb-1.5 text-[11px] text-muted-foreground">{r.description}</p>
                  )}
                  {r.field_type === 'document' ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted">
                      {uploading === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : reqValues[r.id] ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {reqValues[r.id]
                        ? t('voice.numberUploaded')
                        : uploading === r.id
                          ? t('voice.numberUploading')
                          : t('voice.numberUpload')}
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadDoc(r.id, f);
                        }}
                      />
                    </label>
                  ) : r.field_type === 'address' ? (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          placeholder={t('voice.numberAddrBusiness')}
                          value={addr[r.id]?.business ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({ ...a, [r.id]: { ...a[r.id], business: e.target.value } }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrStreet')}
                          value={addr[r.id]?.street ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({ ...a, [r.id]: { ...a[r.id], street: e.target.value } }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrCity')}
                          value={addr[r.id]?.city ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({ ...a, [r.id]: { ...a[r.id], city: e.target.value } }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrState')}
                          value={addr[r.id]?.state ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({ ...a, [r.id]: { ...a[r.id], state: e.target.value } }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrPostal')}
                          value={addr[r.id]?.postal ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({ ...a, [r.id]: { ...a[r.id], postal: e.target.value } }))
                          }
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveAddress(r.id)}
                        disabled={uploading === r.id}
                      >
                        {uploading === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : reqValues[r.id] ? (
                          <>
                            <Check className="mr-1 h-3.5 w-3.5" />
                            {t('voice.numberAddrSaved')}
                          </>
                        ) : (
                          t('voice.numberAddrSave')
                        )}
                      </Button>
                    </div>
                  ) : (
                    <Input
                      placeholder={r.example || r.label}
                      value={reqValues[r.id] ?? ''}
                      onChange={(e) =>
                        setReqValues((v) => ({ ...v, [r.id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">{t('voice.numberDocsHint')}</p>
              <Button onClick={submitReg} disabled={!allFilled || submitting} className="w-full">
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('voice.numberRegSubmit')
                )}
              </Button>
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
                  <Button size="sm" onClick={() => buy(n.phone_number)} disabled={buyDisabled(n.phone_number)}>
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
