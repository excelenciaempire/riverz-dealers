'use client';

import { ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
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

/**
 * Desplegable de filtro. Muestra "Dimensión: valor" ("Canal: Instagram")
 * porque cerrado sólo se ve la opción elegida: sin el prefijo, "todos" suelto
 * no dejaba saber qué se estaba filtrando. El menú es el del sistema de diseño
 * — la lista nativa del navegador se abría en blanco sobre la app oscura.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== 'all';
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? 'all'))}>
      <SelectPrimitive.Trigger aria-label={label} className={filterChipClass(active)}>
        <span className="whitespace-nowrap">
          {label}: {current}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </SelectPrimitive.Trigger>
      <SelectContent align="start">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
