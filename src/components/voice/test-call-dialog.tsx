'use client';

import { useEffect, useState } from 'react';
import { Loader2, PhoneCall } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { useVoiceReadiness } from '@/hooks/use-voice-readiness';
import {
  blockerCodeFromReason,
  VOICE_BLOCKED_KEY,
  VOICE_BLOCKED_FIX_HREF,
  VOICE_STATUS_KEY,
} from '@/lib/voice/labels';
import type { VoiceCallStatus } from '@/types';
import { CallDetail } from './call-detail';

const TERMINAL: VoiceCallStatus[] = [
  'completed',
  'failed',
  'no_answer',
  'busy',
  'voicemail',
  'canceled',
];

export function TestCallDialog({
  workspaceId,
  agents,
  fixedAgentId,
  disabled,
  onBeforeCall,
}: {
  workspaceId?: string;
  agents: { id: string; name: string }[];
  fixedAgentId?: string | null;
  disabled?: boolean;
  onBeforeCall?: () => Promise<boolean>;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const { readiness } = useVoiceReadiness(workspaceId, fixedAgentId);
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(fixedAgentId ?? agents[0]?.id ?? '');
  const [phone, setPhone] = useState('');
  const [objective, setObjective] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [status, setStatus] = useState<VoiceCallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fixedAgentId) setAgentId(fixedAgentId);
    else if (!agentId && agents[0]) setAgentId(agents[0].id);
  }, [fixedAgentId, agents, agentId]);

  useEffect(() => {
    if (!callId || (status && TERMINAL.includes(status))) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/voice/calls/${callId}`, {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const json = (await response.json()) as {
          call?: { status?: VoiceCallStatus };
        };
        if (json.call?.status) setStatus(json.call.status);
      } catch {
        // A transient connection error should not end progress monitoring.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [callId, status]);

  async function start() {
    if (!workspaceId || !agentId || !phone.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (onBeforeCall && !(await onBeforeCall())) return;
      const response = await fetchWithCsrf('/api/voice/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          agent_id: agentId,
          phone: phone.trim(),
          objective: objective.trim() || undefined,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        call_id?: string;
        error?: string;
      };
      if (!response.ok || !json.call_id) {
        setError(json.error ?? 'insert_failed');
        return;
      }
      setCallId(json.call_id);
      setStatus('queued');
    } finally {
      setSubmitting(false);
    }
  }

  const outbound = readiness?.outbound;
  const canStart = Boolean(
    outbound?.ready && agentId && phone.trim() && !submitting && !callId
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setCallId(null);
            setStatus(null);
            setError(null);
          }
        }}
      >
        <DialogTrigger
          render={<Button size="sm" disabled={disabled || !workspaceId} />}
        >
          <PhoneCall className="mr-1 size-3.5" />
          {t('voice.testCall')}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('voice.testCall')}</DialogTitle>
            <DialogDescription>
              {t('voice.testCallDialogDesc')}
            </DialogDescription>
          </DialogHeader>

          {!fixedAgentId && (
            <label className="space-y-1.5">
              <span className="text-xs font-medium">{t('voice.agent')}</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1.5">
            <span className="text-xs font-medium">
              {t('voice.testCallPhone')}
            </span>
            <Input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={t('voice.testCallPlaceholder')}
              disabled={Boolean(callId)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium">
              {t('voice.testCallObjective')}
            </span>
            <Textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              disabled={Boolean(callId)}
              rows={3}
            />
          </label>

          {outbound && !outbound.ready && (
            <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-xs">
              {outbound.blockers.map((blocker) => (
                <p key={blocker.code} className="text-destructive">
                  {t(VOICE_BLOCKED_KEY[blocker.code])}{' '}
                  {blocker.fixHref && (
                    <Link className="underline" href={blocker.fixHref}>
                      {t('voice.blockedFix')}
                    </Link>
                  )}
                </p>
              ))}
            </div>
          )}
          {error && (
            <p className="text-destructive text-xs">
              {t(VOICE_BLOCKED_KEY[blockerCodeFromReason(error)])}
              {VOICE_BLOCKED_FIX_HREF[blockerCodeFromReason(error)] && (
                <>
                  {' · '}
                  <Link
                    className="underline"
                    href={VOICE_BLOCKED_FIX_HREF[blockerCodeFromReason(error)]!}
                  >
                    {t('voice.blockedFix')}
                  </Link>
                </>
              )}
            </p>
          )}
          {status && (
            <div className="bg-muted rounded-lg px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2">
                {!TERMINAL.includes(status) && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {t(VOICE_STATUS_KEY[status])}
              </span>
              {callId && TERMINAL.includes(status) && (
                <Button
                  variant="link"
                  size="sm"
                  className="ml-2 h-auto p-0"
                  onClick={() => {
                    setOpen(false);
                    setDetailId(callId);
                    setCallId(null);
                    setStatus(null);
                    setError(null);
                  }}
                >
                  {t('voice.testCallViewDetail')}
                </Button>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={start} disabled={!canStart}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t('voice.testCallStart')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CallDetail callId={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}
