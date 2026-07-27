'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RangeCalendar, type CustomRange } from '@/components/dashboard/date-range-filter';
import { useTimezone } from '@/hooks/use-timezone';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';

export type DatePreset = 'all' | '7d' | '30d' | '90d' | 'custom';

const PRESETS: { value: Exclude<DatePreset, 'custom'>; key: string }[] = [
  { value: 'all', key: 'contacts.dateAnytime' },
  { value: '7d', key: 'contacts.dateLast7' },
  { value: '30d', key: 'contacts.dateLast30' },
  { value: '90d', key: 'contacts.dateLast90' },
];

/**
 * Filtro por fecha de ALTA del contacto.
 *
 * Dice de qué fecha habla ("Alta: …") en vez del "Cualquier fecha" de antes,
 * que dejaba al usuario adivinando si filtraba por alta, por última compra o
 * por última actividad. Y suma el rango a medida con el mismo calendario del
 * panel — no una copia — así los días se cortan en la zona horaria del
 * workspace en las dos pantallas.
 */
export function DateAddedFilter({
  preset,
  custom,
  onChange,
}: {
  preset: DatePreset;
  custom: CustomRange | null;
  onChange: (preset: DatePreset, custom: CustomRange | null) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const tz = useTimezone();
  const [open, setOpen] = useState(false);

  const active = preset !== 'all';
  const label =
    preset === 'custom' && custom
      ? rangeLabel(custom, fmt.date)
      : t(PRESETS.find((p) => p.value === preset)?.key ?? 'contacts.dateAnytime');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring',
          active
            ? 'border-accent/40 bg-accent/15 text-foreground'
            : 'border-border bg-muted/60 text-foreground hover:bg-accent',
        )}
      >
        {t('contacts.dateAddedLabel')}: {label}
        <ChevronDown className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto space-y-2">
        <div className="flex flex-col">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                onChange(p.value, null);
                setOpen(false);
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                preset === p.value
                  ? 'bg-accent/20 font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(p.key)}
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
