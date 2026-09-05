'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  loadContactActivity,
  type ContactActivityEvent,
  type ContactActivityKind,
} from '@/lib/contacts/activity';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import {
  GitBranch,
  Loader2,
  Megaphone,
  MessageSquare,
  PhoneCall,
  Send,
  ShoppingBag,
  ShoppingCart,
  StickyNote,
  Tag as TagIcon,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CallDetail } from '@/components/voice/call-detail';
import {
  fmtCallDuration,
  VOICE_DIRECTION_KEY,
  VOICE_OUTCOME_KEY,
  VOICE_TYPE_KEY,
  voiceStatusLabel,
} from '@/lib/voice/labels';

const KIND_META: Record<
  ContactActivityKind,
  { Icon: typeof TagIcon; labelKey: string; color: string }
> = {
  order: {
    Icon: ShoppingBag,
    labelKey: 'contacts.actOrder',
    color: 'text-emerald-500',
  },
  cart: {
    Icon: ShoppingCart,
    labelKey: 'contacts.actCart',
    color: 'text-amber-500',
  },
  message_in: {
    Icon: MessageSquare,
    labelKey: 'contacts.actMessageIn',
    color: 'text-blue-500',
  },
  message_out: {
    Icon: Send,
    labelKey: 'contacts.actMessageOut',
    color: 'text-sky-500',
  },
  broadcast: {
    Icon: Megaphone,
    labelKey: 'contacts.actBroadcast',
    color: 'text-violet-500',
  },
  automation: {
    Icon: Zap,
    labelKey: 'contacts.actAutomation',
    color: 'text-yellow-500',
  },
  tag: { Icon: TagIcon, labelKey: 'contacts.actTag', color: 'text-pink-500' },
  note: {
    Icon: StickyNote,
    labelKey: 'contacts.actNote',
    color: 'text-muted-foreground',
  },
  flow: {
    Icon: GitBranch,
    labelKey: 'contacts.actFlow',
    color: 'text-indigo-500',
  },
  voice_call: {
    Icon: PhoneCall,
    labelKey: 'contacts.actCall',
    color: 'text-lime-600',
  },
};

const RANGES: { key: string; labelKey: string; days: number }[] = [
  { key: 'all', labelKey: 'contacts.actRangeAll', days: 0 },
  { key: '7', labelKey: 'contacts.actRange7', days: 7 },
  { key: '30', labelKey: 'contacts.actRange30', days: 30 },
  { key: '90', labelKey: 'contacts.actRange90', days: 90 },
];

export function ContactActivityTimeline({
  contact,
}: {
  contact: { id: string; phone?: string | null; workspace_id?: string | null };
}) {
  const supabase = useMemo(() => createClient(), []);
  const t = useT();
  const fmt = useFormat();
  const [events, setEvents] = useState<ContactActivityEvent[] | null>(null);
  const [range, setRange] = useState('all');
  const [onlyCalls, setOnlyCalls] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  // Captured at load time (Date.now() is impure → not allowed during render).
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Reset to the loading state when the contact changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents(null);
    setNowMs(Date.now());
    loadContactActivity(supabase, {
      id: contact.id,
      phone: contact.phone,
      workspace_id: contact.workspace_id,
    })
      .then((e) => {
        if (!cancelled) setEvents(e);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, contact.id, contact.phone, contact.workspace_id]);

  const filtered = useMemo(() => {
    if (!events) return [];
    const days = RANGES.find((r) => r.key === range)?.days ?? 0;
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    const byDate =
      !days || !nowMs ? events : events.filter((e) => new Date(e.at).getTime() >= cutoff);
    return onlyCalls ? byDate.filter((e) => e.kind === 'voice_call') : byDate;
  }, [events, range, nowMs, onlyCalls]);

  return (
    <div className="flex h-full flex-col">
      {/* Date filter */}
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <div className="border-border bg-background inline-flex rounded-lg border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(r.labelKey)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={onlyCalls}
          onClick={() => setOnlyCalls((value) => !value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
            onlyCalls
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'
          )}
        >
          <PhoneCall className="size-3" />
          {t('contacts.actCalls')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {events === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">{t('contacts.actEmpty')}</p>
        ) : (
          <ul className="space-y-0">
            {filtered.map((e) => {
              const meta = KIND_META[e.kind];
              const Icon = meta.Icon;
              const voice = e.voice;
              const status = voice ? voiceStatusLabel(voice) : null;
              const title = voice ? t(VOICE_DIRECTION_KEY[voice.direction]) : t(meta.labelKey);
              const voiceDetail = voice
                ? [
                    t(VOICE_TYPE_KEY[voice.callType]),
                    voice.agentName,
                    voice.durationSeconds ? fmtCallDuration(voice.durationSeconds) : '',
                    voice.maxAttempts > 1
                      ? t('voice.attemptOf', {
                          attempt: voice.attempt,
                          total: voice.maxAttempts,
                        })
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '';
              const statusText = voice
                ? [t(status!.statusKey), voice.outcome ? t(VOICE_OUTCOME_KEY[voice.outcome]) : '']
                    .filter(Boolean)
                    .join(' · ')
                : e.status;
              const content = (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-xs font-semibold">{title}</span>
                    {statusText && (
                      <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                        {statusText}
                      </span>
                    )}
                  </div>
                  {(voiceDetail || e.detail) && (
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {voiceDetail || e.detail}
                    </p>
                  )}
                  {voice?.summary && voiceDetail && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {voice.summary}
                    </p>
                  )}
                  {status?.reasonKey && (
                    <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                      {t(status.reasonKey)}
                    </p>
                  )}
                  <p className="text-muted-foreground/70 mt-0.5 text-[10px]">
                    {fmt.dateTime(e.at, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </>
              );
              return (
                <li key={e.id} className="flex gap-3 py-2.5">
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        'bg-muted flex size-7 shrink-0 items-center justify-center rounded-full',
                        meta.color
                      )}
                    >
                      <Icon className="size-3.5" />
                    </div>
                    <div className="bg-border mt-1 w-px flex-1" />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    {voice ? (
                      <button
                        type="button"
                        onClick={() => setSelectedCallId(voice.callId)}
                        className="hover:bg-muted/60 focus-visible:ring-ring w-full rounded-md text-left transition-colors outline-none focus-visible:ring-2"
                      >
                        {content}
                      </button>
                    ) : (
                      content
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <CallDetail callId={selectedCallId} onClose={() => setSelectedCallId(null)} />
    </div>
  );
}
