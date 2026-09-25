'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Phone, Loader2, Trash2, Check, AlertCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import {
  VOICE_COUNTRIES,
  TIPOS_EN_ORDEN,
  banderaDe,
  paisDeTimezone,
} from '@/lib/voice/countries';

interface Current {
  phone_number: string | null;
  country: string | null;
  telnyx_number_id: string | null;
  billing_available?: boolean;
  subscription?: { phone_number: string; status: string; monthly_cents: number; next_renewal_at: string | null; renewal_reserved: boolean } | null;
}
interface Available {
  phone_number: string;
  locality?: string | null;
  region?: string | null;
  monthly_cost?: string | null;
  upfront_cost?: string | null;
  quote?: string | null;
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
  status: string | null; // approved | pending-approval | declined | …
}

/**
 * Comprar el número del espacio de trabajo.
 *
 * Antes pedía dos cosas que un comercio no sabe: el código ISO del país en una
 * caja de texto de dos letras («CO»), y el «tipo» de número entre local,
 * gratuito, móvil y nacional. Escribir «COL» devolvía una lista vacía sin
 * decir por qué, y elegir el tipo equivocado también.
 *
 * Ahora el país se elige de una lista con bandera y prefijo —preseleccionado
 * con el del comercio, deducido de su zona horaria— y el tipo desaparece: se
 * pide «local», que es el que la gente contesta, y si el país no tiene, se
 * siguen probando los demás solo y se avisa cuál se encontró.
 *
 * Arriba de todo va la frase que más plata ahorra: llamar desde un número
 * extranjero es tirar las llamadas a la basura.
 */
export function VoiceNumberCard() {
  const t = useT();
  const fmt = useFormat();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [current, setCurrent] = useState<Current | null>(null);
  const [regulatory, setRegulatory] = useState<Regulatory | null>(null);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState('');
  const [otroPais, setOtroPais] = useState('');
  /** El tipo que finalmente devolvió resultados, para poder nombrarlo. */
  const [tipo, setTipo] = useState<string>('local');
  const [results, setResults] = useState<Available[]>([]);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [requiresDocs, setRequiresDocs] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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

  const provisioningStatus = current?.subscription?.status;
  useEffect(() => {
    if (!provisioningStatus || provisioningStatus === 'active') return;
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [provisioningStatus, load]);

  // El país del comercio, para que no tenga que elegirlo si acertamos.
  useEffect(() => {
    if (country) return;
    const suyo = paisDeTimezone(workspace?.timezone);
    if (suyo) setCountry(suyo);
  }, [workspace?.timezone, country]);

  const paisElegido = country === 'otro' ? otroPais.trim().toUpperCase() : country;
  const nombrePais =
    VOICE_COUNTRIES.find((c) => c.code === paisElegido)?.name ?? paisElegido;

  const approved = regulatory?.status === 'approved';
  const declined = regulatory?.status === 'declined';
  const pending = !!regulatory?.requirement_group_id && !approved && !declined;

  /**
   * Busca números. Empieza por «local» y, si no hay, sigue con los otros tipos
   * hasta encontrar alguno — el comercio no tiene que saber qué es cada uno.
   */
  async function search() {
    if (!workspace?.id || !paisElegido) return;
    setSearching(true);
    setSearched(true);
    setResults([]);
    try {
      for (const candidato of TIPOS_EN_ORDEN) {
        const res = await fetch(
          `/api/voice/numbers/search?workspace_id=${workspace.id}&country=${paisElegido}&type=${candidato}`,
          { cache: 'no-store' },
        );
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? t('voice.numberBuyError'));
          return;
        }
        const encontrados = (json.numbers ?? []) as Available[];
        // Los requisitos son del país + tipo, así que se guardan los del tipo
        // que efectivamente vamos a comprar.
        if (encontrados.length > 0) {
          setResults(encontrados);
          setTipo(candidato);
          setReqs(json.requirements ?? []);
          setRequiresDocs(!!json.requires_documents);
          return;
        }
        // Sin resultados: si este tipo pedía papeles, igual sirve saberlo.
        if (candidato === 'local') {
          setReqs(json.requirements ?? []);
          setRequiresDocs(!!json.requires_documents);
        }
      }
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
          country_code: paisElegido,
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

  const listos = reqs.filter((r) => !!reqValues[r.id]).length;
  const allFilled = reqs.length > 0 && listos === reqs.length;

  async function submitReg() {
    if (!workspace?.id || !allFilled) return;
    setSubmitting(true);
    try {
      const res = await fetchWithCsrf('/api/voice/numbers/regulatory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          country: paisElegido,
          type: tipo,
          requirements: reqs.map((r) => ({ requirement_id: r.id, field_value: reqValues[r.id] })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setRegulatory({ requirement_group_id: json.requirement_group_id, status: json.status });
      } else {
        toast.error(
          json.error ? `${t('voice.numberRegError')} (${json.error})` : t('voice.numberRegError'),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function buy(phone: string) {
    if (!workspace?.id) return;
    const selected = results.find((n) => n.phone_number === phone);
    if (!selected?.quote) return;
    const monthly = Number(selected.monthly_cost), upfront = Number(selected.upfront_cost);
    const next = new Date();
    const renewal = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1));
    if (!window.confirm(t('voice.numberPurchaseConfirm', {
      phone, monthly: fmt.currency(monthly, 'USD'), upfront: fmt.currency(upfront, 'USD'),
      initial: fmt.currency(monthly + upfront, 'USD'), date: fmt.date(renewal, { timeZone: 'UTC' }),
    }))) return;
    setBusy(phone);
    try {
      const res = await fetchWithCsrf('/api/voice/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          phone_number: phone,
          country: paisElegido,
          type: tipo,
          requirement_group_id: requiresDocs ? regulatory?.requirement_group_id : undefined,
          quote: selected.quote,
          consent_version: 'number_v1',
        }),
      });
      const json = await res.json().catch(() => ({}));
      // 402: el cartel de cobro ya dice por qué, sin repetirlo en un aviso.
      if (res.status === 402) return;
      if (!res.ok) {
        toast.error(
          json.error ? `${t('voice.numberBuyError')} (${json.error})` : t('voice.numberBuyError'),
        );
        return;
      }
      toast.success(t(json.status === 'active' ? 'voice.numberBought' : 'voice.numberPending'));
      setResults([]);
      setSearched(false);
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

  const compraBloqueada = requiresDocs && !approved;

  return (
    <section className="border-border bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid size-9 shrink-0 place-items-center rounded-xl">
          <Phone className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('voice.numberTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('voice.numberDesc')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : current?.phone_number || current?.subscription ? (
        /* Ya tiene número: una línea y nada más que decidir. */
        <div className="mt-4">
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium">{current.phone_number ?? current.subscription?.phone_number}</span>
              {current.country && (
                <span className="text-xs text-muted-foreground">
                  {banderaDe(current.country)} {current.country}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={release}
              disabled={busy === 'release' || (!!current.subscription && current.subscription.status !== 'active')}
              aria-label={t('voice.numberRelease')}
            >
              {busy === 'release' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
          {current.subscription && (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {current.subscription.status !== 'active' && <p>{t('voice.numberPending')}</p>}
              {current.subscription.next_renewal_at && <p>{t('voice.numberRenewalDetails', { amount: fmt.currency(current.subscription.monthly_cents / 100, 'USD'), date: fmt.date(current.subscription.next_renewal_at, { timeZone: 'UTC' }) })}</p>}
              <p>{t(current.subscription.renewal_reserved ? 'voice.numberRenewalReserved' : 'voice.numberRenewalFunding')}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {current?.billing_available === false && <p className="text-xs text-amber-600">{t('voice.numberBillingUnavailable')}</p>}
          {/* La decisión, y por qué importa. */}
          <div>
            <p className="text-sm text-foreground">{t('voice.numberPickCountry')}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t('voice.numberLocalWins')}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="h-9 min-w-[190px] rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="">{t('voice.numberCountry')}…</option>
              {VOICE_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {banderaDe(c.code)} {c.name} ({c.dial})
                </option>
              ))}
              <option value="otro">{t('voice.numberOtherCountry')}</option>
            </select>

            {country === 'otro' && (
              <Input
                value={otroPais}
                onChange={(e) => setOtroPais(e.target.value.toUpperCase())}
                placeholder="PT"
                maxLength={2}
                className="w-20"
              />
            )}

            <Button onClick={search} disabled={searching || !paisElegido}>
              {searching ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  {t('voice.numberSearching')}
                </>
              ) : (
                t('voice.numberSearch')
              )}
            </Button>
          </div>
          {country === 'otro' && (
            <p className="text-[11px] text-muted-foreground">
              {t('voice.numberOtherCountryHint')}
            </p>
          )}

          {/* El papeleo del país, con cuánto falta. */}
          {requiresDocs && approved && (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5 shrink-0" />
              {t('voice.numberRegApprovedHint')}
            </p>
          )}
          {requiresDocs && pending && (
            <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-300">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              {t('voice.numberRegStatusPending')} · {t('voice.numberRegPendingHint')}
            </p>
          )}
          {requiresDocs && declined && (
            <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t('voice.numberRegStatusDeclined')} · {t('voice.numberRegStatusDeclinedHint')}
            </p>
          )}

          {requiresDocs && !approved && !pending && reqs.length > 0 && (
            <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t('voice.numberDocsCountry', { country: nombrePais })}
                </p>
                <span className="text-[11px] text-muted-foreground">
                  {t('voice.numberDocsProgress', {
                    done: String(listos),
                    total: String(reqs.length),
                  })}
                </span>
              </div>
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
                            setAddr((a) => ({
                              ...a,
                              [r.id]: { ...a[r.id], business: e.target.value },
                            }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrStreet')}
                          value={addr[r.id]?.street ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({
                              ...a,
                              [r.id]: { ...a[r.id], street: e.target.value },
                            }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrCity')}
                          value={addr[r.id]?.city ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({
                              ...a,
                              [r.id]: { ...a[r.id], city: e.target.value },
                            }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrState')}
                          value={addr[r.id]?.state ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({
                              ...a,
                              [r.id]: { ...a[r.id], state: e.target.value },
                            }))
                          }
                        />
                        <Input
                          placeholder={t('voice.numberAddrPostal')}
                          value={addr[r.id]?.postal ?? ''}
                          onChange={(e) =>
                            setAddr((a) => ({
                              ...a,
                              [r.id]: { ...a[r.id], postal: e.target.value },
                            }))
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
                      onChange={(e) => setReqValues((v) => ({ ...v, [r.id]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">{t('voice.numberDocsHint')}</p>
              <Button onClick={submitReg} disabled={!allFilled || submitting} className="w-full">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('voice.numberRegSubmit')}
              </Button>
            </div>
          )}

          {/* Los números. Uno por fila, con el precio dicho como precio. */}
          {results.length > 0 && (
            <div className="space-y-2">
              {tipo !== 'local' && (
                <p className="text-[11px] text-muted-foreground">
                  {t('voice.numberFoundType', { type: t(`voice.numberType${TIPO_KEY[tipo]}`) })}
                </p>
              )}
              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {results.map((n) => (
                  <li
                    key={n.phone_number}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {n.phone_number}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {[n.locality || n.region, n.quote ? t('voice.numberInitialPrice', { initial: fmt.currency(Number(n.upfront_cost) + Number(n.monthly_cost), 'USD'), monthly: fmt.currency(Number(n.monthly_cost), 'USD') }) : t('voice.numberPriceUnavailable')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      onClick={() => buy(n.phone_number)}
                      disabled={!!busy || compraBloqueada || !n.quote || current?.billing_available === false}
                    >
                      {busy === n.phone_number ? (
                        <>
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          {t('voice.numberBuying')}
                        </>
                      ) : (
                        t('voice.numberBuy')
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {searched && !searching && results.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('voice.numberNoResults')}</p>
          )}
        </div>
      )}
    </section>
  );
}

/** El tipo, como sufijo de la clave del catálogo. */
const TIPO_KEY: Record<string, string> = {
  local: 'Local',
  toll_free: 'TollFree',
  mobile: 'Mobile',
  national: 'National',
};
