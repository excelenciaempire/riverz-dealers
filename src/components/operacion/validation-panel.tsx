'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { evaluarEscenario, type ValidationOutcome, type ValidationScenario } from '@/lib/operacion/validacion';

interface ValidationData {
  agents: Array<{ id: string; name: string }>;
  channels: string[];
  scenarios: ValidationScenario[];
  readiness: { blockers: string[]; warnings: string[] };
  latest: { status: 'passed' | 'warning' | 'blocked'; agent_id: string } | null;
}

export function ValidationPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [data, setData] = useState<ValidationData | null>(null);
  const [running, setRunning] = useState(false);
  const [released, setReleased] = useState(false);
  const [error, setError] = useState(false);
  const [outcomes, setOutcomes] = useState<ValidationOutcome[]>([]);

  const load = async () => {
    try {
      const response = await fetch('/api/operacion/validacion', { cache: 'no-store' });
      if (!response.ok) throw new Error('load_failed');
      setData((await response.json()) as ValidationData);
    } catch {
      setError(true);
    }
  };
  useEffect(() => { void load(); }, []);

  const agent = data?.agents[0] ?? null;
  const latest = data?.latest;
  const latestStatus = latest?.agent_id === agent?.id ? latest?.status ?? null : null;
  const run = async () => {
    if (!agent || !data || running) return;
    setRunning(true);
    setError(false);
    try {
      const next: ValidationOutcome[] = [];
      for (const scenario of data.scenarios) {
        const response = await fetchWithCsrf(`/api/ai/agents/${agent.id}/test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: scenario.message,
            simulated_channel: data.channels[0] ?? 'webchat',
          }),
        });
        if (!response.ok) throw new Error('test_failed');
        const result = (await response.json()) as { reply: string; herramientas?: string[] };
        next.push(evaluarEscenario(scenario, result.reply, result.herramientas ?? []));
      }
      const response = await fetchWithCsrf('/api/operacion/validacion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, channel: data.channels[0] ?? 'webchat', outcomes: next }),
      });
      if (!response.ok) throw new Error('record_failed');
      const result = (await response.json()) as { run: { status: 'passed' | 'warning' | 'blocked' } };
      setOutcomes(next);
      setData((current) => current ? { ...current, latest: { status: result.run.status, agent_id: agent.id } } : current);
    } catch {
      setError(true);
    } finally {
      setRunning(false);
    }
  };

  const release = async () => {
    if (!agent) return;
    try {
      const response = await fetchWithCsrf('/api/operacion/validacion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'release', agentId: agent.id }),
      });
      if (!response.ok) throw new Error('release_failed');
      setReleased(true);
    } catch {
      setError(true);
    }
  };

  if (!data) return null;
  if (!agent) return <p className="text-sm text-muted-foreground">{t('operation.validationNoAgent')}</p>;
  const status = latestStatus ?? (data.readiness.blockers.length ? 'blocked' : null);
  const title = status === 'passed' ? t('operation.validationPassed') : status === 'warning' ? t('operation.validationWarning') : status === 'blocked' ? t('operation.validationBlocked') : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        {status === 'passed' ? <ShieldCheck className="mt-0.5 size-5 text-accent-ink" /> : <TriangleAlert className="mt-0.5 size-5 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{t('operation.validationTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('operation.validationHint')}</p>
          {title && <p className="mt-3 text-sm font-medium text-foreground">{title}</p>}
        </div>
      </div>
      {outcomes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {outcomes.map((outcome) => (
            <li key={outcome.id} className="flex items-center gap-2 text-sm text-muted-foreground">
              {outcome.status === 'passed' ? <Check className="size-4 text-accent-ink" /> : <TriangleAlert className="size-4" />}
              {t('operation.validationScenario')}: {outcome.id}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{t('operation.validationError')}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => void run()} disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" /> : null}
          {running ? t('operation.validationRunning') : t('operation.validationRun')}
        </Button>
        {status === 'passed' && !released && (
          <Button variant="outline" onClick={() => void release()}>{t('operation.validationRelease')}</Button>
        )}
        {released && <span className="inline-flex items-center gap-1 text-sm text-accent-ink"><Check className="size-4" />{t('operation.validationReleased')}</span>}
      </div>
    </section>
  );
}
