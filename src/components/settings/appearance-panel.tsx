"use client";

import { Check, Languages, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { useLocale, useT } from "@/hooks/use-locale";
import { THEMES, type ThemeId } from "@/lib/themes";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Appearance panel — light / dark mode picker + UI language picker.
 *
 * Click a card → applies + persists immediately. No save button: theme is a
 * single data-theme swap on <html>; language updates the cookie + localStorage
 * and refreshes server-rendered copy. The active card carries a check chip.
 *
 * Persistence: theme is localStorage only (device-scoped). Language is cookie
 * + localStorage + profile (cross-device for signed-in users).
 */
export function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <section className="space-y-8">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t("settings.appearance")}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {THEMES.map((th) => {
            const name = t(th.id === "dark" ? "settings.themeDark" : "settings.themeLight");
            const tagline = t(
              th.id === "dark" ? "settings.themeDarkTagline" : "settings.themeLightTagline",
            );
            return (
              <ThemeCard
                key={th.id}
                id={th.id}
                name={name}
                tagline={tagline}
                swatch={th.swatch}
                isActive={th.id === theme}
                ariaLabel={t("settings.useTheme", { name })}
                idLabel={t("settings.themeId", { id: th.id })}
                onPick={() => setTheme(th.id)}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t("settings.language")}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LOCALES.map((loc) => (
            <LanguageCard
              key={loc}
              name={LOCALE_NAMES[loc]}
              isActive={loc === locale}
              ariaLabel={t("settings.useLanguage", { name: LOCALE_NAMES[loc] })}
              onPick={() => setLocale(loc as Locale)}
            />
          ))}
        </div>
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
  ariaLabel,
  idLabel,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  ariaLabel: string;
  idLabel: string;
  onPick: () => void;
}) {
  const isDark = id === "dark";
  const Icon = isDark ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={ariaLabel}
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
            color: isDark ? "#fafaf7" : "#1b1a17",
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
      {/* Mini preview: superficie, el lima de la marca y el borde del modo. */}
      <div className="mt-1 flex h-2 overflow-hidden rounded-full" aria-hidden>
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-5" style={{ background: "#f7ff9e" }} />
        <span
          className="w-3"
          style={{ background: isDark ? "#25252e" : "#ded8c8" }}
        />
      </div>
      <span className="sr-only">{idLabel}</span>
    </button>
  );
}

function LanguageCard({
  name,
  isActive,
  ariaLabel,
  onPick,
}: {
  name: string;
  isActive: boolean;
  ariaLabel: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={ariaLabel}
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-foreground/30 hover:bg-accent",
      )}
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
        >
          <Languages className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-foreground">{name}</span>
      </span>
      {isActive && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}
