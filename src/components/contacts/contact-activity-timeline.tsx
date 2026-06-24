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
  Send,
  ShoppingBag,
  ShoppingCart,
  StickyNote,
  Tag as TagIcon,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const KIND_META: Record<
  ContactActivityKind,
  { Icon: typeof TagIcon; labelKey: string; color: string }
> = {
  order: { Icon: ShoppingBag, labelKey: 'contacts.actOrder', color: 'text-emerald-500' },
  cart: { Icon: ShoppingCart, labelKey: 'contacts.actCart', color: 'text-amber-500' },
  message_in: { Icon: MessageSquare, labelKey: 'contacts.actMessageIn', color: 'text-blue-500' },
  message_out: { Icon: Send, labelKey: 'contacts.actMessageOut', color: 'text-sky-500' },
  broadcast: { Icon: Megaphone, labelKey: 'contacts.actBroadcast', color: 'text-violet-500' },
  automation: { Icon: Zap, labelKey: 'contacts.actAutomation', color: 'text-yellow-500' },
  tag: { Icon: TagIcon, labelKey: 'contacts.actTag', color: 'text-pink-500' },
  note: { Icon: StickyNote, labelKey: 'contacts.actNote', color: 'text-muted-foreground' },
  flow: { Icon: GitBranch, labelKey: 'contacts.actFlow', color: 'text-indigo-500' },
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
    if (!days || !nowMs) return events;
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    return events.filter((e) => new Date(e.at).getTime() >= cutoff);
  }, [events, range, nowMs]);

  return (
    <div className="flex h-full flex-col">
      {/* Date filter */}
      <div className="mb-3 inline-flex shrink-0 rounded-lg border border-border bg-background p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              range === r.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(r.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {events === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('contacts.actEmpty')}
          </p>
        ) : (
          <ul className="space-y-0">
            {filtered.map((e) => {
              const meta = KIND_META[e.kind];
              const Icon = meta.Icon;
              return (
                <li key={e.id} className="flex gap-3 py-2.5">
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full bg-muted',
                        meta.color,
                      )}
                    >
                      <Icon className="size-3.5" />
                    </div>
                    <div className="mt-1 w-px flex-1 bg-border" />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {t(meta.labelKey)}
                      </span>
                      {e.status && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {e.status}
                        </span>
                      )}
                    </div>
                    {e.detail && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {e.detail}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      {fmt.dateTime(e.at, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
