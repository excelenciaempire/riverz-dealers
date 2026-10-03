'use client';

import { useState, type DragEvent } from 'react';
import { Clock3, GripVertical, ArrowUpRight } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import {
  STAGES,
  vehicleTitle,
  type DealerData,
  type Opportunity,
} from '@/lib/dealers/types';
import { cn } from '@/lib/utils';

type Stage = Opportunity['stage'];
const dragType = 'application/x-riverz-opportunity';
const dots: Record<Stage, string> = {
  inquiry: 'bg-slate-400',
  qualified: 'bg-blue-500',
  appointment: 'bg-violet-500',
  visit: 'bg-cyan-500',
  negotiation: 'bg-amber-500',
  won: 'bg-emerald-500',
  lost: 'bg-rose-400',
};

export function OpportunityPipeline({
  data,
  opportunities,
  busy,
  onMove,
  onEdit,
  onInbox,
}: {
  data: DealerData;
  opportunities: Opportunity[];
  busy: boolean;
  onMove: (opportunity: Opportunity, stage: Stage) => Promise<void>;
  onEdit: (opportunity: Opportunity) => void;
  onInbox?: (contactId: string) => void;
}) {
  const t = useT(),
    fmt = useFormat();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  function drop(e: DragEvent, stage: Stage) {
    e.preventDefault();
    const id = e.dataTransfer.getData(dragType);
    setDragging(null);
    setOver(null);
    const o = opportunities.find((o) => o.id === id);
    if (o && !busy && o.stage !== stage) void onMove(o, stage);
  }
  return (
    <div className="min-w-0 space-y-3" aria-busy={busy}>
      <p className="text-muted-foreground text-xs">
        {t('dealers.pipelineHint')}
      </p>
      <div
        className="max-w-full overflow-x-auto pb-4"
        role="region"
        aria-label={t('dealers.pipeline')}
        tabIndex={0}
      >
        <div className="flex items-stretch gap-3">
          {STAGES.map((stage) => {
            const rows = opportunities.filter((o) => o.stage === stage);
            return (
              <section
                key={stage}
                data-stage={stage}
                aria-label={t(`dealers.${stage}`)}
                className={cn(
                  'bg-muted/35 min-h-96 w-64 shrink-0 rounded-xl border p-3 transition-colors',
                  over === stage && 'border-primary bg-primary/5'
                )}
                onDragOver={(e) => {
                  if (!busy && e.dataTransfer.types.includes(dragType)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setOver(stage);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setOver(null);
                }}
                onDrop={(e) => drop(e, stage)}
              >
                <header className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    <span className={cn('h-2 w-2 rounded-full', dots[stage])} />
                    {t(`dealers.${stage}`)}
                  </h2>
                  <span className="text-muted-foreground bg-background rounded-md px-2 py-0.5 text-xs tabular-nums">
                    {fmt.number(rows.length)}
                  </span>
                </header>
                <div className="space-y-3">
                  {rows.map((o) => {
                    const c = data.contacts.find((c) => c.id === o.contact_id);
                    const name = c?.name || t('dealers.anonymous');
                    const vehicles = data.vehicles.filter((v) =>
                      data.interests.some(
                        (i) =>
                          i.opportunity_id === o.id && i.vehicle_id === v.id
                      )
                    );
                    const late =
                      !o.follow_up_paused &&
                      !c?.opted_out &&
                      o.next_follow_up_at &&
                      Date.parse(o.next_follow_up_at) <= Date.now();
                    return (
                      <article
                        key={o.id}
                        data-opportunity={o.id}
                        draggable={!busy}
                        onDragStart={(e) => {
                          if (
                            (e.target as HTMLElement).closest(
                              'button,select,a,input'
                            ) ||
                            busy
                          ) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.setData(dragType, o.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragging(o.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        className={cn(
                          'bg-card rounded-lg border p-3 shadow-sm',
                          !busy && 'cursor-grab active:cursor-grabbing',
                          dragging === o.id && 'opacity-40'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className="text-left text-sm font-medium hover:underline"
                            onClick={() => onEdit(o)}
                          >
                            {name}
                          </button>
                          <GripVertical
                            className="text-muted-foreground h-4 w-4 shrink-0"
                            aria-hidden
                          />
                        </div>
                        {o.budget !== null && (
                          <p className="mt-1 text-xs tabular-nums">
                            {fmt.currency(o.budget, o.currency)}
                          </p>
                        )}
                        <p className="text-muted-foreground mt-3 line-clamp-2 text-xs">
                          {o.preferences || t('dealers.unknownPreferences')}
                        </p>
                        {vehicles.slice(0, 2).map((v) => (
                          <p
                            key={v.id}
                            className="mt-2 truncate text-xs"
                            title={vehicleTitle(v)}
                          >
                            {vehicleTitle(v)}
                          </p>
                        ))}
                        {o.next_follow_up_at && (
                          <p
                            className={cn(
                              'mt-3 flex items-center gap-1.5 text-xs',
                              late
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-muted-foreground'
                            )}
                          >
                            <Clock3 className="h-3.5 w-3.5 shrink-0" />
                            {fmt.dateTime(o.next_follow_up_at)}
                          </p>
                        )}
                        {(c?.opted_out || o.follow_up_paused) && (
                          <p className="text-muted-foreground mt-2 text-xs">
                            {t(
                              c?.opted_out
                                ? 'dealers.optedOut'
                                : 'dealers.paused'
                            )}
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-2 border-t pt-3">
                          <select
                            value={o.stage}
                            disabled={busy}
                            aria-label={t('dealers.moveBuyer', { name })}
                            className="bg-background focus:ring-ring min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs focus:ring-2"
                            onChange={(e) => {
                              const stage = e.target.value as Stage;
                              if (STAGES.includes(stage) && stage !== o.stage)
                                void onMove(o, stage);
                            }}
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>
                                {t(`dealers.${s}`)}
                              </option>
                            ))}
                          </select>
                          {onInbox && (
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={t('dealers.openInbox')}
                              title={t('dealers.openInbox')}
                              onClick={() => onInbox(o.contact_id)}
                              className="hover:bg-muted rounded-md p-2"
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {!rows.length && (
                    <p className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-xs">
                      {t('dealers.emptyStage')}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
