'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RangeCalendar, type CustomRange } from '@/components/dashboard/date-range-filter';
import { filterChipClass } from '@/components/contacts/filter-chip';
import { rangeForPreset } from '@/lib/dashboard/date-utils';
import { useTimezone } from '@/hooks/use-timezone';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';

/** Preset relativo o rango elegido a mano en el calendario. */
export type DateChipPreset = 'all' | '7d' | '30d' | '90d' | 'custom';

/**
 * Preset → ventana `[from, to)` en ISO, lista para `.gte()/.lt()` o para
 * mandarla por querystring. El rango a medida se corta en días completos de la
 * zona horaria del workspace; los relativos son móviles (N×24 h hacia atrás).
 */
export function dateChipBounds(
  preset: DateChipPreset,
  custom: CustomRange | null,
  tz: string,
): { from?: string; to?: string } {
  if (preset === 'custom') {
    if (!custom) return {};
    const r = rangeForPreset(tz, 'custom', custom);
    return { from: r.start.toISOString(), to: r.end.toISOString() };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 0;
  if (days === 0) return {};
  return { from: new Date(Date.now() - days * 864e5).toISOString() };
}

export interface DateChipOption {
  value: Exclude<DateChipPreset, 'custom'>;
  /** Clave i18n de la etiqueta. */
  key: string;
}

/**
 * Chip de filtro por fecha: presets rápidos + rango a medida en calendario.
 *
 * Un solo componente para todas las listas (contactos, llamadas): los días se
 * cortan siempre en la zona horaria del workspace porque comparten el mismo
 * `RangeCalendar` del panel, y el chip dice de qué fecha habla ("Alta: …",
 * "Fecha: …") en vez de un "cualquier fecha" suelto que obliga a adivinar.
 */
export function DateRangeChip({
  label,
  options,
  preset,
  custom,
  onChange,
}: {
  label: string;
  options: DateChipOption[];
  preset: DateChipPreset;
  custom: CustomRange | null;
  onChange: (preset: DateChipPreset, custom: CustomRange | null) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const tz = useTimezone();
  const [open, setOpen] = useState(false);

  const active = preset !== 'all';
  const current =
    preset === 'custom' && custom
      ? rangeLabel(custom, fmt.date)
      : t(options.find((o) => o.value === preset)?.key ?? options[0].key);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={filterChipClass(active)}>
        <span className="whitespace-nowrap">
          {label}: {current}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto space-y-2">
        <div className="flex flex-col">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value, null);
                setOpen(false);
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                preset === o.value
                  ? 'bg-accent-ink/10 font-medium text-accent-ink'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(o.key)}
            </button>
          ))}
        </div>
        <div className="border-t border-border pt-2">
          <RangeCalendar
            tz={tz}
            value={preset === 'custom' ? custom : null}
            onSelect={(r) => {
              onChange('custom', r);
              setOpen(false);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function rangeLabel(
  c: CustomRange,
  df: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string,
): string {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const f = (d: Date) => df(d, { day: 'numeric', month: 'short' });
  return c.start === c.end ? f(parse(c.start)) : `${f(parse(c.start))} – ${f(parse(c.end))}`;
}
