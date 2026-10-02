"use client";

/**
 * Command palette del editor de flujos. Se abre con Cmd/Ctrl+K y
 * permite buscar y saltar a un nodo por nombre, agregar un nodo nuevo
 * por tipo, o disparar acciones globales (Guardar, Auto-organizar,
 * Centrar). El estilo replica el patrón de Linear/Notion/Raycast para
 * que sea reconocible de entrada.
 *
 * Lista plana, ranking por substring match con boost para prefijos.
 * Flechas navegan; Enter ejecuta; Esc cierra.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

export interface CommandItem {
  /** Categoría visible a la izquierda del ítem. */
  group: string;
  /** Texto principal. */
  label: string;
  /** Texto adicional (descripción corta). */
  hint?: string;
  /** Acción a ejecutar al elegir. */
  run: () => void;
  /** Atajo de teclado opcional para mostrar a la derecha. */
  shortcut?: string;
}

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) { setQuery(''); setActiveIdx(0); }
  }

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items
      .map((it) => {
        const haystack = `${it.label} ${it.hint ?? ""} ${it.group}`.toLowerCase();
        if (!haystack.includes(q)) return null;
        const isPrefix = it.label.toLowerCase().startsWith(q);
        return { item: it, score: isPrefix ? 0 : 1 };
      })
      .filter((x): x is { item: CommandItem; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.item)
      .slice(0, 30);
  }, [items, query]);


  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) =>
        filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) {
        item.run();
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/40"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder={t("flows.palettePlaceholder")}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("flows.esc")}
          </kbd>
        </div>
        <ul
          className="max-h-[50vh] overflow-y-auto py-1"
          onKeyDown={onKeyDown}
        >
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              {t("flows.paletteNoResults", { query })}
            </li>
          )}
          {filtered.map((it, i) => (
            <li key={`${it.group}-${it.label}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  it.run();
                  onClose();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors",
                  i === activeIdx ? "bg-accent" : "hover:bg-muted",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {it.group}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {it.label}
                    </span>
                  </div>
                  {it.hint && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {it.hint}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {it.shortcut && (
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {it.shortcut}
                    </kbd>
                  )}
                  {i === activeIdx && (
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>{t("flows.paletteNavHint")}</span>
          <span>{t("flows.paletteOpenHint")}</span>
        </div>
      </div>
    </div>
  );
}
