'use client';

import { useEffect, useState } from 'react';
import { PhoneCall, PhoneIncoming, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
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

function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compact call card shown above the transcript for a voice conversation. */
export function VoiceCallCard({ conversationId }: { conversationId: string }) {
  const t = useT();
  const [call, setCall] = useState<VoiceCall | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('voice_calls')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setCall((data as VoiceCall | null) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (loading || !call) return null;

  const inbound = call.direction === 'inbound';
  return (
    <div className="mx-4 mt-3 rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        {inbound ? (
          <PhoneIncoming className="h-4 w-4 text-violet-500" />
        ) : (
          <PhoneCall className="h-4 w-4 text-violet-500" />
        )}
        <span className="text-sm font-medium text-foreground">
          {inbound ? t('voice.callInbound') : t('voice.callOutbound')}
        </span>
        <span className="ml-auto rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-500">
          {t(STATUS_KEY[call.status])}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t('voice.duration')}: <span className="text-foreground">{fmtDuration(call.duration_seconds)}</span>
        </span>
        {call.outcome && (
          <span>
            {t('voice.outcome')}:{' '}
            <span className="text-foreground">{t(OUTCOME_KEY[call.outcome])}</span>
          </span>
        )}
      </div>
      {call.summary && (
        <p className="mt-2 text-xs text-foreground/90">
          <span className="text-muted-foreground">{t('voice.summary')}: </span>
          {call.summary}
        </p>
      )}
    </div>
  );
}

/** "Call with AI" action — enqueues a manual call to a contact. */
export function CallWithAiButton({
  workspaceId,
  contactId,
  className,
}: {
  workspaceId: string;
  contactId: string;
  className?: string;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [loading, setLoading] = useState(false);

  async function call() {
    setLoading(true);
    try {
      const res = await fetchWithCsrf('/api/voice/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, contact_id: contactId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ? `${t('voice.callFailed')} (${json.error})` : t('voice.callFailed'));
        return;
      }
      toast.success(t('voice.callQueued'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={call}
      disabled={loading}
      title={t('voice.callWithAi')}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50',
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
      {t('voice.callWithAi')}
    </button>
  );
}
