'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Una lista corta de textos: dominios, preguntas sugeridas, páginas.
 *
 * Las tres eran el mismo bloque copiado tres veces —chip con su X, campo,
 * botón de agregar, Enter que agrega— con tres bugs distintos posibles. Acá va
 * una sola vez.
 *
 * El campo desaparece al llegar al tope en vez de dejar escribir y rechazar
 * después: un botón que no hace nada se lee como roto.
 */
export function ListaDeChips({
  values,
  onChange,
  placeholder,
  addLabel,
  max,
  maxLength = 120,
  suggestions = [],
  suggestionsLabel,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  /** Texto del botón. Sin él, el botón es sólo el `+`. */
  addLabel?: string;
  max?: number;
  maxLength?: number;
  /** Valores que ya conocemos y se agregan con un clic. */
  suggestions?: string[];
  suggestionsLabel?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const lleno = max != null && values.length >= max;
  const nuevas = suggestions.filter((s) => !values.includes(s));

  const add = () => {
    const value = draft.trim();
    if (!value || lleno || values.includes(value)) return;
    setDraft('');
    onChange([...values, value]);
  };

  return (
    <div className="space-y-2">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground"
            >
              {v}
              <button
                type="button"
                aria-label={v}
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {nuevas.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {suggestionsLabel ? (
            <span className="text-xs text-muted-foreground">{suggestionsLabel}</span>
          ) : null}
          {nuevas.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange([...values, s])}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-foreground transition hover:border-primary/60 hover:bg-primary/5"
            >
              <Plus className="h-3 w-3" />
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {lleno ? null : (
        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={add} disabled={disabled}>
            {addLabel ?? <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
    </div>
  );
}
