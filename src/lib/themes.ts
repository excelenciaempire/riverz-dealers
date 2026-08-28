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

/**
 * Default for the *app* surface (dashboard, auth, legal): warm cream light.
 * Only the default before the visitor makes an explicit choice — a saved
 * light/dark preference (STORAGE_KEY) still wins on every surface.
 */
export const DEFAULT_THEME: ThemeId = "light";

/**
 * Default for the public marketing *landing* (`/`): deep charcoal dark — the
 * landing reads as a dark editorial surface first. This is only the default
 * shown before the visitor makes an explicit choice; the theme preference is a
 * single shared value (STORAGE_KEY), so once anyone toggles light/dark
 * anywhere, that choice wins on every surface. See the path-aware boot script
 * in `src/app/layout.tsx`.
 */
export const DEFAULT_LANDING_THEME: ThemeId = "dark";

/**
 * Marketing routes that default to {@link DEFAULT_LANDING_THEME} instead of
 * {@link DEFAULT_THEME}. Currently just the landing root; kept as a list so
 * additional public pages can opt into the dark-first default later. Matching
 * is exact (full pathname) — duplicated literally in the boot script string,
 * so keep the two in sync.
 */
export const LANDING_PATHS: ReadonlyArray<string> = ["/"];

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
    tagline: "Crema editorial — superficies cálidas y tinta carbón.",
    swatch: "#f5f3ec",
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
