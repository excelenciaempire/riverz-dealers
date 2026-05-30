"use client";

import { Check, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { THEMES, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * Appearance panel — light / dark mode picker.
 *
 * Click a card → applies + persists immediately. No save button:
 * the whole change is a single data-theme swap on <html>, there's
 * nothing to roll back. The active card carries a check chip + a
 * primary-tinted border so the current pick is obvious.
 *
 * Persistence: localStorage only (device-scoped). The boot script in
 * layout.tsx replays the choice before first paint on subsequent
 * loads.
 */
export function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Apariencia</h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            id={t.id}
            name={t.name}
            tagline={t.tagline}
            swatch={t.swatch}
            isActive={t.id === theme}
            onPick={() => setTheme(t.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  const isDark = id === "dark";
  const Icon = isDark ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={`Usar el tema ${name}`}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-foreground/30 hover:bg-accent",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: swatch,
            color: isDark ? "#fafaf7" : "#0a0a0a",
            boxShadow: "inset 0 0 0 1px rgba(120,120,120,0.25)",
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{name}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {tagline}
        </div>
      </div>
      {/* Mini preview: surface, then the shared lime accent swatch. */}
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-5" style={{ background: "#f7ff9e" }} />
        <span
          className="w-3"
          style={{ background: isDark ? "#25252e" : "#e8e1d2" }}
        />
      </div>
      <span className="sr-only">ID del tema: {id}</span>
    </button>
  );
}
