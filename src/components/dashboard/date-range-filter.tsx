"use client"

import { useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { dayKey, type RangePreset } from '@/lib/dashboard/date-utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'

export interface CustomRange {
  /** YYYY-MM-DD */
  start: string
  /** YYYY-MM-DD */
  end: string
}

interface DateRangeFilterProps {
  /** Workspace IANA timezone — the clock every range boundary is resolved in. */
  tz: string
  preset: RangePreset
  custom: CustomRange | null
  onChange: (preset: RangePreset, custom?: CustomRange | null) => void
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'dashboard.rangeToday' },
  { key: 'yesterday', label: 'dashboard.rangeYesterday' },
  { key: '7d', label: 'dashboard.range7d' },
  { key: '30d', label: 'dashboard.range30d' },
]

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Global date-range filter: preset chips + a custom calendar range picker.
 *
 * Every boundary ("Hoy", "Ayer", el día que se toca en el calendario) se
 * resuelve en la zona horaria del WORKSPACE, no en la del navegador. Por eso el
 * calendario recibe `tz`: sin él, un equipo en Bogotá viendo un workspace en
 * Buenos Aires no podía siquiera seleccionar el día en curso del workspace
 * (quedaba deshabilitado como "futuro") entre las 22:00 y la medianoche.
 */
export function DateRangeFilter({ tz, preset, custom, onChange }: DateRangeFilterProps) {
  const t = useT()
  const fmt = useFormat()
  const [open, setOpen] = useState(false)

  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1"
      title={t('dashboard.rangeTimezone', { tz })}
    >
      {PRESETS.map((p) => (
        <Chip key={p.key} active={preset === p.key} onClick={() => onChange(p.key)}>
          {t(p.label)}
        </Chip>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 md:py-1 text-xs font-medium transition-colors',
            preset === 'custom'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <CalendarIcon className="size-3.5" />
          {preset === 'custom' && custom ? customLabel(custom, fmt.date) : t('dashboard.custom')}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto">
          <RangeCalendar
            tz={tz}
            value={preset === 'custom' ? custom : null}
            onSelect={(r) => {
              onChange('custom', r)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-2 md:py-1 text-xs font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function customLabel(
  c: CustomRange,
  df: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string,
): string {
  const f = (d: Date) => df(d, { day: 'numeric', month: 'short' })
  const s = parseYmd(c.start)
  const e = parseYmd(c.end)
  return c.start === c.end ? f(s) : `${f(s)} – ${f(e)}`
}

const WEEKDAY_KEYS = [
  'dashboard.weekdayMon',
  'dashboard.weekdayTue',
  'dashboard.weekdayWed',
  'dashboard.weekdayThu',
  'dashboard.weekdayFri',
  'dashboard.weekdaySat',
  'dashboard.weekdaySun',
]

function RangeCalendar({
  tz,
  value,
  onSelect,
}: {
  tz: string
  value: CustomRange | null
  onSelect: (r: CustomRange) => void
}) {
  const t = useT()
  const fmt = useFormat()
  // "Hoy" del workspace, no del navegador — es el mismo día que usa
  // rangeForPreset al convertir el YYYY-MM-DD elegido a un instante real.
  const todayKey = dayKey(tz, new Date())
  const [month, setMonth] = useState<Date>(() =>
    parseYmd(value ? value.end : todayKey),
  )
  // First click sets the start and waits for the end click.
  const [pendingStart, setPendingStart] = useState<string | null>(null)

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const handleClick = (key: string) => {
    if (!pendingStart) {
      setPendingStart(key)
    } else {
      const [a, b] = pendingStart <= key ? [pendingStart, key] : [key, pendingStart]
      setPendingStart(null)
      onSelect({ start: a, end: b })
    }
  }

  const isSelected = (key: string): boolean => {
    if (pendingStart) return key === pendingStart
    if (!value) return false
    return key >= value.start && key <= value.end
  }
  const isEdge = (key: string): boolean => {
    if (pendingStart) return key === pendingStart
    if (!value) return false
    return key === value.start || key === value.end
  }

  return (
    <div className="w-64">
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          aria-label={t('dashboard.prevMonth')}
          onClick={() => setMonth(subMonths(month, 1))}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-xs font-medium capitalize text-foreground">
          {fmt.date(month, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          aria-label={t('dashboard.nextMonth')}
          onClick={() => setMonth(addMonths(month, 1))}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
        {WEEKDAY_KEYS.map((key, i) => (
          <div key={i}>{t(key)}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const key = ymd(d)
          const future = key > todayKey
          const selected = isSelected(key)
          const edge = isEdge(key)
          return (
            <button
              key={key}
              type="button"
              disabled={future}
              onClick={() => handleClick(key)}
              className={cn(
                'h-9 sm:h-7 rounded text-xs tabular-nums transition-colors',
                !isSameMonth(d, month) && 'text-muted-foreground/40',
                future && 'cursor-not-allowed opacity-30',
                edge
                  ? 'bg-accent font-semibold text-accent-ink'
                  : selected
                    ? 'bg-accent/25 text-foreground'
                    : !future && 'hover:bg-muted',
              )}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>

      <p className="px-1 pt-2 text-[10px] text-muted-foreground">
        {pendingStart ? t('dashboard.pickEndDate') : t('dashboard.pickStartDate')}
      </p>
    </div>
  )
}
