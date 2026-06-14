'use client';

import { useMemo } from 'react';

interface ActiveHoursChartProps {
  /** ISO timestamps of when each message was sent. */
  timestamps: (string | null | undefined)[];
}

/**
 * Hour-of-day histogram of send activity, mirroring the campaign
 * dashboard's "Horas activas" panel. Buckets each sent_at into its local
 * hour (0–23) and draws proportional bars. Pure CSS, no chart lib.
 */
export function ActiveHoursChart({ timestamps }: ActiveHoursChartProps) {
  const { buckets, max, total } = useMemo(() => {
    const b = new Array<number>(24).fill(0);
    let t = 0;
    for (const ts of timestamps) {
      if (!ts) continue;
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) continue;
      b[d.getHours()]++;
      t++;
    }
    return { buckets: b, max: Math.max(...b, 1), total: t };
  }, [timestamps]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-foreground">Horas activas</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Cuándo se enviaron los mensajes durante el día.
      </p>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Aún no hay envíos para mostrar actividad por hora.
        </p>
      ) : (
        <div className="flex h-40 items-end gap-[2px]">
          {buckets.map((count, hour) => (
            <div
              key={hour}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${hour}:00 — ${count} envío${count === 1 ? '' : 's'}`}
            >
              <div
                className="w-full rounded-sm bg-foreground/40 transition-all group-hover:bg-foreground/70"
                style={{ height: `${Math.max(2, (count / max) * 100)}%` }}
              />
              {hour % 3 === 0 && (
                <span className="mt-1 text-[9px] text-muted-foreground">
                  {hour}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
