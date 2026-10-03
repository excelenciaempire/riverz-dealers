'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import Link from '@/components/i18n/locale-link';
import { Button } from '@/components/ui/button';
import { dealerSettings, type DealerSettings } from '@/lib/dealers/settings';
import { DealerError } from '@/lib/dealers/validation';
import { STAGES } from '@/lib/dealers/types';
import { translate } from '@/lib/i18n/translate';

interface State {
  settings: DealerSettings;
  version: number;
  can_manage: boolean;
  workspace_id: string;
  team: { user_id: string; name: string }[];
  credentials: { lead: boolean; inventory: boolean };
  runs: {
    id: string;
    status: string;
    units: number;
    created_count: number;
    changed_count: number;
    retired_count: number;
    started_at: string;
  }[];
}
const inputClass = 'w-full rounded-lg border bg-background px-3 py-2 text-sm';
export function DealerGrowthSettings({ onSaved }: { onSaved: () => void }) {
  const t = useT(),
    fmt = useFormat(),
    request = useFetchWithCsrf(),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [dirty, setDirty] = useState(false),
    [leadKey, setLeadKey] = useState(''),
    [token, setToken] = useState(''),
    [upload, setUpload] = useState<{
      text: string;
      format: 'json' | 'csv';
    } | null>(null),
    [preview, setPreview] = useState<{
      units: number;
      unpriced: number;
    } | null>(null);
  async function load(preserve = false) {
    const r = await fetch('/api/dealers/settings', { cache: 'no-store' });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setState((previous) =>
      preserve && previous
        ? { ...b, settings: previous.settings, version: previous.version }
        : b
    );
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function post(path: string, body: unknown) {
    const r = await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    return b;
  }
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await task();
    } catch (e) {
      setError(
        e instanceof Error &&
          !(e instanceof DealerError) &&
          !(e instanceof SyntaxError)
          ? e.message
          : t('dealers.err_invalid')
      );
    } finally {
      setBusy(false);
    }
  }
  function update(section: keyof DealerSettings, key: string, value: unknown) {
    if (!state) return;
    setDirty(true);
    setPreview(null);
    setSaved(false);
    setState({
      ...state,
      settings: {
        ...state.settings,
        [section]: { ...state.settings[section], [key]: value },
      },
    });
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await action(async () => {
      if (!state) return;
      const value = structuredClone(state.settings);
      value.inventory.mapping = JSON.parse(
        String(f.get('inventory_mapping') || '{}')
      );
      value.coach.practice_objections = String(f.get('coach_objections'))
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean);
      value.metrics.lost_reasons = String(f.get('lost_reasons'))
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean);
      const b = await post('/api/dealers/settings', {
        action: 'save',
        version: state.version,
        settings: dealerSettings(value),
      });
      setState({ ...state, ...b });
      setSaved(true);
      setDirty(false);
      onSaved();
    });
  }
  if (!state)
    return (
      <div className="rounded-xl border p-5">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">{t('dealers.loading')}</p>
        )}
      </div>
    );
  function field(section: keyof DealerSettings, key: string, value: unknown) {
    const label = t(`dealers.g_${section}_${key}`),
      id = `g-${section}-${key}`;
    if (typeof value === 'boolean')
      return (
        <label key={key} className="flex min-h-10 items-center gap-2 text-sm">
          <input
            disabled={!state?.can_manage || busy}
            type="checkbox"
            checked={value}
            onChange={(e) => update(section, key, e.target.checked)}
          />
          {label}
        </label>
      );
    if (key === 'weekdays')
      return (
        <fieldset key={key} className="space-y-2 text-sm">
          <legend>{label}</legend>
          <div className="flex flex-wrap gap-3">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <label key={day} className="flex gap-1.5">
                <input
                  type="checkbox"
                  disabled={!state?.can_manage || busy}
                  checked={(value as number[]).includes(day)}
                  onChange={(e) =>
                    update(
                      section,
                      key,
                      e.target.checked
                        ? [...(value as number[]), day]
                        : (value as number[]).filter((d) => d !== day)
                    )
                  }
                />
                {t(`dealers.day_${day}`)}
              </label>
            ))}
          </div>
        </fieldset>
      );
    if (
      key === 'mapping' ||
      key === 'practice_objections' ||
      key === 'lost_reasons' ||
      key === 'labels'
    )
      return null;
    return (
      <label key={key} htmlFor={id} className="grid gap-2 text-sm">
        {label}
        {key === 'default_seller_id' ? (
          <select
            id={id}
            className={inputClass}
            disabled={!state?.can_manage || busy}
            value={String(value ?? '')}
            onChange={(e) => update(section, key, e.target.value || null)}
          >
            <option value="">{t('dealers.owner')}</option>
            {state?.team.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.name}
              </option>
            ))}
          </select>
        ) : key === 'format' || key === 'language' ? (
          <select
            id={id}
            className={inputClass}
            disabled={!state?.can_manage || busy}
            value={String(value)}
            onChange={(e) => update(section, key, e.target.value)}
          >
            {(key === 'format' ? ['json', 'csv'] : ['es', 'en']).map((v) => (
              <option key={v} value={v}>
                {key === 'format'
                  ? v.toUpperCase()
                  : v === 'es'
                    ? 'Español'
                    : 'English'}
              </option>
            ))}
          </select>
        ) : key === 'instructions' ? (
          <textarea
            id={id}
            className={`${inputClass} min-h-24`}
            maxLength={3000}
            disabled={!state?.can_manage || busy}
            value={String(value)}
            onChange={(e) => update(section, key, e.target.value)}
          />
        ) : (
          <input
            id={id}
            className={inputClass}
            disabled={!state?.can_manage || busy}
            type={
              typeof value === 'number'
                ? 'number'
                : key.endsWith('_url')
                  ? 'url'
                  : 'text'
            }
            value={String(value ?? '')}
            min={typeof value === 'number' ? 0 : undefined}
            maxLength={key.endsWith('_url') ? 2048 : 500}
            onChange={(e) =>
              update(
                section,
                key,
                typeof value === 'number'
                  ? Number(e.target.value)
                  : e.target.value
              )
            }
          />
        )}
      </label>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/integraciones" className="underline">
          {t('dealers.connectChannels')}
        </Link>
        <Link href="/automatizaciones" className="underline">
          {t('dealers.configureRecipes')}
        </Link>
        <Link href="/asistente" className="underline">
          {t('dealers.configureAssistant')}
        </Link>
      </div>
      {!state.can_manage && (
        <p className="text-sm">{t('dealers.managerOnly')}</p>
      )}
      <form onSubmit={save} className="space-y-3">
        {(Object.keys(state.settings) as (keyof DealerSettings)[]).map(
          (section) => (
            <details
              key={section}
              open={section === 'business'}
              className="rounded-xl border p-5"
            >
              <summary className="cursor-pointer font-medium">
                {t(`dealers.group_${section}`)}
              </summary>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {Object.entries(state.settings[section]).map(([key, value]) =>
                  field(section, key, value)
                )}
                {section === 'inventory' && (
                  <label className="grid gap-2 text-sm md:col-span-2">
                    {t('dealers.feedMapping')}
                    <textarea
                      key={`mapping-${state.version}`}
                      name="inventory_mapping"
                      onChange={() => {
                        setDirty(true);
                        setPreview(null);
                      }}
                      className={`${inputClass} min-h-24 font-mono`}
                      defaultValue={JSON.stringify(
                        state.settings.inventory.mapping,
                        null,
                        2
                      )}
                      disabled={!state.can_manage || busy}
                    />
                  </label>
                )}
                {section === 'coach' && (
                  <label className="grid gap-2 text-sm md:col-span-2">
                    {t('dealers.practiceObjections')}
                    <textarea
                      key={`objections-${state.version}`}
                      name="coach_objections"
                      onChange={() => {
                        setDirty(true);
                        setPreview(null);
                      }}
                      className={inputClass}
                      defaultValue={state.settings.coach.practice_objections.join(
                        '\n'
                      )}
                      disabled={!state.can_manage || busy}
                    />
                  </label>
                )}
                {section === 'metrics' && (
                  <label className="grid gap-2 text-sm md:col-span-2">
                    {t('dealers.lostReasons')}
                    <textarea
                      key={`reasons-${state.version}`}
                      name="lost_reasons"
                      onChange={() => {
                        setDirty(true);
                        setPreview(null);
                      }}
                      className={inputClass}
                      defaultValue={state.settings.metrics.lost_reasons.join(
                        '\n'
                      )}
                      disabled={!state.can_manage || busy}
                    />
                  </label>
                )}
                {section === 'pipeline' &&
                  STAGES.map((stage) => (
                    <fieldset key={stage} className="space-y-2">
                      <legend className="text-sm">
                        {t(`dealers.${stage}`)}
                      </legend>
                      {(['es', 'en'] as const).map((locale) => (
                        <label
                          key={locale}
                          className="flex items-center gap-2 text-xs"
                        >
                          {locale.toUpperCase()}
                          <input
                            className={inputClass}
                            maxLength={40}
                            disabled={!state.can_manage || busy}
                            value={
                              state.settings.pipeline.labels[stage]?.[locale] ??
                              translate(locale, `dealers.${stage}`)
                            }
                            onChange={(e) =>
                              update('pipeline', 'labels', {
                                ...state.settings.pipeline.labels,
                                [stage]: {
                                  es:
                                    state.settings.pipeline.labels[stage]?.es ??
                                    translate('es', `dealers.${stage}`),
                                  en:
                                    state.settings.pipeline.labels[stage]?.en ??
                                    translate('en', `dealers.${stage}`),
                                  [locale]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </fieldset>
                  ))}
              </div>
            </details>
          )
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm">
            {t('dealers.savedSettings')}
          </p>
        )}
        <Button disabled={busy || !state.can_manage} type="submit">
          {t(busy ? 'dealers.loading' : 'dealers.save')}
        </Button>
      </form>
      {state.can_manage && (
        <>
          <details className="rounded-xl border p-5">
            <summary className="cursor-pointer font-medium">
              {t('dealers.leadConnector')}
            </summary>
            <div className="mt-4 space-y-4">
              <p className="bg-muted rounded-lg p-3 font-mono text-xs break-all">
                {typeof window !== 'undefined' ? window.location.origin : ''}
                /api/dealers/leads/{state.workspace_id}
              </p>
              <p className="text-sm">
                {t(
                  state.credentials.lead
                    ? 'dealers.keyConfigured'
                    : 'dealers.keyNotConfigured'
                )}
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const b = await post('/api/dealers/settings', {
                      action: 'rotate_lead_key',
                    });
                    setLeadKey(b.key);
                    await load(true);
                  })
                }
              >
                {t(
                  state.credentials.lead
                    ? 'dealers.rotateKey'
                    : 'dealers.createKey'
                )}
              </Button>
              {leadKey && (
                <div className="space-y-2">
                  <p className="text-xs">{t('dealers.keyOnce')}</p>
                  <input
                    className={inputClass}
                    aria-label={t('dealers.leadKey')}
                    readOnly
                    value={leadKey}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void navigator.clipboard.writeText(leadKey)}
                  >
                    {t('dealers.copy')}
                  </Button>
                </div>
              )}
            </div>
          </details>
          <details className="rounded-xl border p-5">
            <summary className="cursor-pointer font-medium">
              {t('dealers.inventoryConnection')}
            </summary>
            <div className="mt-4 space-y-4">
              <label className="grid gap-2 text-sm">
                {t('dealers.feedToken')}
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  maxLength={2000}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !token}
                  onClick={() =>
                    void action(async () => {
                      await post('/api/dealers/settings', {
                        action: 'inventory_token',
                        token,
                      });
                      setToken('');
                      await load(true);
                    })
                  }
                >
                  {t('dealers.saveToken')}
                </Button>
                {state.credentials.inventory && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await post('/api/dealers/settings', {
                          action: 'inventory_token',
                          token: '',
                        });
                        await load(true);
                      })
                    }
                  >
                    {t('dealers.removeToken')}
                  </Button>
                )}
                <Button
                  disabled={busy || dirty || !state.settings.inventory.feed_url}
                  onClick={() =>
                    void action(async () => {
                      await post('/api/dealers/inventory', { action: 'sync' });
                      await load(true);
                      onSaved();
                    })
                  }
                >
                  {t('dealers.syncNow')}
                </Button>
              </div>
              <label className="grid gap-2 text-sm">
                {t('dealers.uploadFeed')}
                <input
                  type="file"
                  accept=".json,.csv"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setPreview(null);
                    setUpload(null);
                    if (file) {
                      if (file.size > 8 * 1024 * 1024) {
                        setError(t('dealers.err_feed'));
                        return;
                      }
                      void file.text().then((text) =>
                        setUpload({
                          text,
                          format: file.name.toLowerCase().endsWith('.csv')
                            ? 'csv'
                            : 'json',
                        })
                      );
                    }
                  }}
                />
              </label>
              {upload && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setPreview(
                          await post('/api/dealers/inventory', {
                            action: 'preview',
                            ...upload,
                          })
                        )
                      )
                    }
                  >
                    {t('dealers.previewFeed')}
                  </Button>
                  <Button
                    disabled={busy || dirty || !preview}
                    onClick={() =>
                      void action(async () => {
                        await post('/api/dealers/inventory', {
                          action: 'import',
                          ...upload,
                        });
                        setPreview(null);
                        setUpload(null);
                        await load(true);
                        onSaved();
                      })
                    }
                  >
                    {t('dealers.importFeed')}
                  </Button>
                </div>
              )}
              {dirty && (
                <p className="text-sm">{t('dealers.saveBeforeSync')}</p>
              )}
              {preview && (
                <p className="text-sm">
                  {t('dealers.feedPreview', {
                    units: fmt.number(preview.units),
                    unpriced: fmt.number(preview.unpriced),
                  })}
                </p>
              )}
              <div className="space-y-2">
                {state.runs.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap justify-between gap-2 border-t py-3 text-xs"
                  >
                    <span>{fmt.dateTime(run.started_at)}</span>
                    <span>
                      {t(`dealers.sync_${run.status}`)} ·{' '}
                      {fmt.number(run.units)} {t('dealers.vehicles')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
