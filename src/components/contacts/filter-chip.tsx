'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Estilo único de los filtros de la lista de contactos.
 *
 * Un solo criterio de color para toda la barra: en reposo el chip es neutro
 * (gris); aplicado se enciende en lima — el mismo acento que marca "activo" en
 * el resto de la app. Antes cada filtro se resaltaba distinto y el resaltado
 * era casi invisible, así que a simple vista no se sabía cuáles filtraban.
 */
export function filterChipClass(active: boolean): string {
  return cn(
    'inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent-ink/40',
    active
      ? 'border-accent-ink/50 bg-accent-ink/10 text-accent-ink'
      : 'border-border bg-muted/60 text-muted-foreground hover:border-foreground/25 hover:text-foreground',
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Filtro de varias opciones: el chip queda compacto ("Canal: WhatsApp +2") y al
 * abrirlo son casillas, así se pueden ver dos canales a la vez.
 *
 * La regla es la misma en toda la barra y se lee en una línea: dentro de un
 * filtro basta con cualquiera de las opciones marcadas; entre filtros distintos
 * las condiciones se suman. Sin nada marcado, el filtro no filtra.
 */
export function FilterMultiSelect({
  label,
  allLabel,
  values,
  onChange,
  options,
}: {
  label: string;
  /** Texto del chip cuando no hay nada marcado ("todos"). */
  allLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.filter((o) => values.includes(o.value));
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length === 1
        ? chosen[0].label
        : `${chosen[0].label} +${chosen.length - 1}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={label} className={filterChipClass(chosen.length > 0)}>
        <span className="whitespace-nowrap">
          {label}: {summary}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-44 gap-0 p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={values.includes(o.value)}
              onChange={() =>
                onChange(
                  values.includes(o.value)
                    ? values.filter((v) => v !== o.value)
                    : [...values, o.value],
                )
              }
              className="size-3.5 cursor-pointer accent-primary"
            />
            {o.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
