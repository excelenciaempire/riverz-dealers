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
import type { RangePreset } from '@/lib/dashboard/date-utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface CustomRange {
  /** YYYY-MM-DD */
  start: string
  /** YYYY-MM-DD */
  end: string
}

interface DateRangeFilterProps {
  preset: RangePreset
  custom: CustomRange | null
  onChange: (preset: RangePreset, custom?: CustomRange | null) => void
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'yesterday', label: 'Ayer' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
]

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Global date-range filter: preset chips + a custom calendar range picker. */
export function DateRangeFilter({ preset, custom, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1">
      {PRESETS.map((p) => (
        <Chip key={p.key} active={preset === p.key} onClick={() => onChange(p.key)}>
          {p.label}
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
          {preset === 'custom' && custom ? customLabel(custom) : 'Personalizado'}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto">
          <RangeCalendar
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

function customLabel(c: CustomRange): string {
  const f = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  const s = parseYmd(c.start)
  const e = parseYmd(c.end)
  return c.start === c.end ? f(s) : `${f(s)} – ${f(e)}`
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function RangeCalendar({
  value,
  onSelect,
}: {
  value: CustomRange | null
  onSelect: (r: CustomRange) => void
}) {
  const [month, setMonth] = useState<Date>(() => (value ? parseYmd(value.end) : new Date()))
  // First click sets the start and waits for the end click.
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  const todayKey = ymd(new Date())

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
          aria-label="Mes anterior"
          onClick={() => setMonth(subMonths(month, 1))}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-xs font-medium capitalize text-foreground">
          {month.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          aria-label="Mes siguiente"
          onClick={() => setMonth(addMonths(month, 1))}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
        {WEEKDAYS.map((d, i) => (
          <div key={i}>{d}</div>
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
        {pendingStart ? 'Elige la fecha final…' : 'Elige la fecha inicial'}
      </p>
    </div>
  )
}
