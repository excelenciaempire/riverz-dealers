/**
 * Single source of truth for the color-theme catalog.
 *
 * The CSS variables themselves live in `src/app/globals.css` under
 * `html[data-theme="..."]` blocks — that file is the one we paste
 * theme tokens into. This module only carries the metadata the UI
 * (settings picker, no-flash boot script) needs.
 *
 * The app ships the Riverz editorial design in two modes: a warm
 * cream "light" theme and a charcoal "dark" theme. The accent
 * (chartreuse-yellow) is shared by both. Switching modes is a single
 * data-theme swap on <html>.
 */

export const THEME_IDS = ["light", "dark"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "light";

export const STORAGE_KEY = "wacrm.theme";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  /**
   * Static swatch color for the picker chip — the dominant surface of
   * the mode, so the card preview reads at a glance without a
   * getComputedStyle round trip. Mirrors `--background` of the mode.
   */
  swatch: string;
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: "light",
    name: "Claro",
    tagline: "Crema editorial — superficies cálidas, tinta carbón, acento lima.",
    swatch: "#fafaf7",
  },
  {
    id: "dark",
    name: "Oscuro",
    tagline: "Carbón profundo — ideal para sesiones largas y poca luz.",
    swatch: "#0a0a0a",
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as ReadonlyArray<string>).includes(value)
  );
}
