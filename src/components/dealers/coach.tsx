'use client';
import { useState } from 'react';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
export function DealerCoach({ opportunityId }: { opportunityId?: string }) {
  const t = useT(),
    request = useFetchWithCsrf(),
    [open, setOpen] = useState(false),
    [mode, setMode] = useState(opportunityId ? 'brief' : 'practice'),
    [input, setInput] = useState(''),
    [consent, setConsent] = useState(false),
    [output, setOutput] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setError('');
    try {
      const r = await request('/api/dealers/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          input,
          consent,
          opportunity_id: opportunityId,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setOutput(b.output);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dealers.err_failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('dealers.coach')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dealers.coach')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <select
              className="bg-background w-full rounded-lg border p-2 text-sm"
              value={mode}
              aria-label={t('dealers.coachMode')}
              onChange={(e) => {
                setMode(e.target.value);
                setOutput('');
              }}
            >
              {(opportunityId
                ? ['brief', 'review', 'practice']
                : ['review', 'practice']
              ).map((m) => (
                <option key={m} value={m}>
                  {t(`dealers.coach_${m}`)}
                </option>
              ))}
            </select>
            {mode !== 'brief' && (
              <label className="grid gap-2 text-sm">
                {t(
                  mode === 'review'
                    ? 'dealers.transcript'
                    : 'dealers.practiceReply'
                )}
                <textarea
                  className="bg-background min-h-32 rounded-lg border p-3"
                  maxLength={12000}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
              </label>
            )}
            {mode === 'review' && input && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                {t('dealers.transcriptConsent')}
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm">
                {error}
              </p>
            )}
            <Button
              disabled={busy || (mode === 'review' && !!input && !consent)}
              onClick={() => void run()}
            >
              {t(busy ? 'dealers.loading' : 'dealers.coachGenerate')}
            </Button>
            {output && (
              <div
                className="rounded-xl border p-4 text-sm leading-relaxed whitespace-pre-wrap"
                role="status"
              >
                {output}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
