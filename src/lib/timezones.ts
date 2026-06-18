// Shared IANA timezone helpers. The app reports in a single workspace-level
// timezone (see migration 072 + useTimezone); this module is the one place
// that enumerates the zone list for the settings dropdowns and holds the
// default everything falls back to.

/** Where the initial team operates; every tz fallback resolves here. */
export const DEFAULT_TIMEZONE = 'America/Bogota';

// Enough Latam + common zones to be useful if the engine can't enumerate
// the full IANA set (older runtimes lacking Intl.supportedValuesOf).
const FALLBACK_ZONES = [
  'America/Bogota',
  'America/Mexico_City',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Madrid',
  'Europe/London',
  'UTC',
];

/**
 * Every IANA zone the runtime knows, for the timezone <select>.
 * Intl.supportedValuesOf is the standard enumerator; we fall back to a
 * small handpicked list where it's unavailable.
 */
export function listTimeZones(): string[] {
  try {
    const sv = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    if (sv) {
      const zones = sv('timeZone');
      if (zones && zones.length > 0) return zones;
    }
  } catch {
    // Fall through to the handpicked list.
  }
  return FALLBACK_ZONES;
}
