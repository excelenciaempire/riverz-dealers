'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { PhoneCall, PhoneIncoming, Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { VoiceCall, VoiceCallOutcome, VoiceCallStatus } from '@/types';

const STATUS_KEY: Record<VoiceCallStatus, string> = {
  queued: 'voice.statusQueued',
  dialing: 'voice.statusDialing',
  in_progress: 'voice.statusInProgress',
  completed: 'voice.statusCompleted',
  failed: 'voice.statusFailed',
  no_answer: 'voice.statusNoAnswer',
  busy: 'voice.statusBusy',
  voicemail: 'voice.statusVoicemail',
  canceled: 'voice.statusCanceled',
};

const OUTCOME_KEY: Record<VoiceCallOutcome, string> = {
  confirmed: 'voice.outcomeConfirmed',
  cancelled_by_customer: 'voice.outcomeCancelled',
  rescheduled: 'voice.outcomeRescheduled',
  recovered: 'voice.outcomeRecovered',
  declined: 'voice.outcomeDeclined',
  callback_requested: 'voice.outcomeCallback',
  opt_out: 'voice.outcomeOptOut',
  no_outcome: 'voice.outcomeNone',
};

interface TranscriptTurn {
  role: 'agent' | 'customer';
  text: string;
  ts: string;
}

type CallRow = VoiceCall & { contact?: { id: string; name: string | null; phone: string | null } };

function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Per-call drill-down: metadata, recording playback and the transcript.
 *  Controlled by `callId`; renders nothing until one is selected. */
export function CallDetail({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const t = useT();
  const format = useFormat();
  const [call, setCall] = useState<CallRow | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    setLoading(true);
    setCall(null);
    setTranscript([]);
    (async () => {
      try {
        const res = await fetch(`/api/voice/calls/${callId}`, { cache: 'no-store' });
        if (res.ok && !cancelled) {
          const json = (await res.json()) as { call: CallRow; transcript: TranscriptTurn[] };
          setCall(json.call);
          setTranscript(json.transcript ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  const cost = call?.cost?.total_usd ?? 0;

  return (
    <Dialog open={!!callId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {call?.direction === 'inbound' ? (
              <PhoneIncoming className="h-4 w-4 text-violet-500" />
            ) : (
              <PhoneCall className="h-4 w-4 text-violet-500" />
            )}
            {call?.contact?.name || call?.phone || t('voice.callDetail')}
          </DialogTitle>
        </DialogHeader>

        {loading || !call ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Metadata */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Meta label={t('voice.colStatus')} value={t(STATUS_KEY[call.status])} />
              <Meta
                label={t('voice.outcome')}
                value={call.outcome ? t(OUTCOME_KEY[call.outcome]) : '—'}
              />
              <Meta label={t('voice.duration')} value={fmtDuration(call.duration_seconds)} />
              <Meta label={t('voice.colWhen')} value={format.dateTime(new Date(call.created_at))} />
              {call.city && <Meta label={t('voice.city')} value={call.city} />}
              {call.max_attempts > 1 && (
                <Meta label={t('voice.attempt')} value={`${call.attempt}/${call.max_attempts}`} />
              )}
              {!!call.upsell_amount && call.upsell_amount > 0 && (
                <Meta
                  label={t('voice.upsellAmount')}
                  value={format.number(call.upsell_amount)}
                />
              )}
              {cost > 0 && <Meta label={t('voice.metricCost')} value={`$${cost.toFixed(2)}`} />}
            </dl>

            {/* Recording */}
            {call.recording_url && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t('voice.recording')}
                </p>
                <audio controls preload="none" src={call.recording_url} className="w-full">
                  <track kind="captions" />
                </audio>
              </div>
            )}

            {/* Summary */}
            {call.summary && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t('voice.summary')}</p>
                <p className="text-sm text-foreground/90">{call.summary}</p>
              </div>
            )}

            {/* Error */}
            {call.error && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="text-amber-700 dark:text-amber-300">{call.error}</span>
              </div>
            )}

            {/* Transcript */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t('voice.transcript')}</p>
              {transcript.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('voice.noTranscript')}</p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {transcript.map((turn, i) => (
                    <div
                      key={i}
                      className={
                        turn.role === 'customer'
                          ? 'ml-6 rounded-lg bg-primary/10 p-2'
                          : 'mr-6 rounded-lg bg-muted p-2'
                      }
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {turn.role === 'customer' ? t('voice.roleCustomer') : t('voice.roleAgent')}
                      </p>
                      <p className="text-sm text-foreground">{turn.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Open the full thread in the inbox */}
            {call.conversation_id && (
              <div className="flex justify-end">
                <Link
                  href={`/bandeja?c=${call.conversation_id}`}
                  className="text-xs text-primary underline"
                >
                  {t('voice.openInInbox')}
                </Link>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
