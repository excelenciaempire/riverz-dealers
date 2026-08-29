"use client";

import { Languages, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { useLocale, useT } from "@/hooks/use-locale";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Los dos interruptores de un clic: tema e idioma.
 *
 * `AppearancePanel` los ofrece como tarjetas grandes en Ajustes, que es donde se
 * elige con calma. Estos son la versión de barra, para cuando el control tiene
 * que caber al lado de un correo y un candado.
 *
 * Viven acá y no dentro de cada barra porque ya había dos copias del de tema
 * —el sidebar del comercio y las tarjetas de Ajustes— y el panel de plataforma
 * iba a ser la tercera. Con dos idiomas el control no es un menú: es un botón
 * que va al otro.
 */

/** Clases del botón cuadrado, iguales para los dos. */
const BASE =
  "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground";

export function ThemeToggleButton({ className }: { className?: string }) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={t(dark ? "nav.switchToLight" : "nav.switchToDark")}
      title={t(dark ? "nav.lightTheme" : "nav.darkTheme")}
      className={cn(BASE, className)}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/**
 * Idioma en un botón.
 *
 * Muestra el idioma ACTIVO —no el destino— porque el botón también es el
 * indicador: en una barra sin más señales, ver "EN" es la única forma de saber
 * en qué idioma se está. A dónde lleva el clic lo dice el `title`.
 */
export function LocaleToggleButton({ className }: { className?: string }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const next: Locale = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length];

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={t("settings.useLanguage", { name: LOCALE_NAMES[next] })}
      title={t("settings.useLanguage", { name: LOCALE_NAMES[next] })}
      className={cn(BASE, "w-auto gap-1.5 px-2", className)}
    >
      <Languages className="h-4 w-4" />
      <span className="text-xs font-medium uppercase">{locale}</span>
    </button>
  );
}
