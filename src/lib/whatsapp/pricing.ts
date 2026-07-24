import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * WhatsApp campaign cost estimation, aligned to Meta's pricing model.
 *
 * Since mid-2025 Meta bills business-initiated TEMPLATE messages PER MESSAGE
 * delivered, priced by (template category, destination country). User-initiated
 * / service messages are free. So a precise campaign estimate is:
 *
 *   Σ over recipients  rate(recipient.country, template.category)
 *
 * The rates below are sensible defaults for the main markets; they change and
 * vary by country, so an operator can paste their exact Meta rate card via the
 * NEXT_PUBLIC_WHATSAPP_RATES_JSON env (same shape as WHATSAPP_RATES). This
 * replaces the old flat NEXT_PUBLIC_META_MSG_COST_USD × recipients estimate.
 */

export type TemplateCategory = "marketing" | "utility" | "authentication";

type RateRow = Partial<Record<TemplateCategory, number>>;

/** Per-message rates in USD by destination country (ISO-3166-1 alpha-2). */
export const WHATSAPP_RATES: Record<string, RateRow> = {
  AR: { marketing: 0.0618, utility: 0.03, authentication: 0.0367 },
  BR: { marketing: 0.0625, utility: 0.008, authentication: 0.0315 },
  CL: { marketing: 0.0889, utility: 0.008, authentication: 0.0525 },
  CO: { marketing: 0.0125, utility: 0.0008, authentication: 0.0077 },
  MX: { marketing: 0.0305, utility: 0.0085, authentication: 0.0224 },
  PE: { marketing: 0.0703, utility: 0.008, authentication: 0.041 },
  US: { marketing: 0.025, utility: 0.004, authentication: 0.0135 },
  ES: { marketing: 0.0662, utility: 0.0044, authentication: 0.018 },
};

/** Fallback per-category rate when the country isn't in the table. */
export const DEFAULT_RATE: Record<TemplateCategory, number> = {
  marketing: 0.05,
  utility: 0.01,
  authentication: 0.03,
};

function envOverrides(): Record<string, RateRow> | null {
  try {
    const raw = process.env.NEXT_PUBLIC_WHATSAPP_RATES_JSON;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, RateRow>) : null;
  } catch {
    return null;
  }
}

/** Normalize a MessageTemplate.category ('Marketing'|…) to our lowercase key. */
export function toCategory(raw: string | null | undefined): TemplateCategory {
  const c = (raw ?? "").toLowerCase();
  if (c === "utility") return "utility";
  if (c === "authentication") return "authentication";
  return "marketing"; // default to the most expensive so estimates never undershoot
}

/** ISO-2 country of a phone number (E.164 or bare digits), or null. */
export function countryFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (!trimmed) return null;
  try {
    const p = parsePhoneNumberFromString(trimmed.startsWith("+") ? trimmed : `+${trimmed}`);
    return p?.country ?? null;
  } catch {
    return null;
  }
}

/** Per-message rate for a (country, category). Override → table → default. */
export function rateFor(country: string | null | undefined, category: TemplateCategory): number {
  const cc = (country ?? "").toUpperCase();
  if (cc) {
    const ov = envOverrides()?.[cc]?.[category];
    if (typeof ov === "number") return ov;
    const t = WHATSAPP_RATES[cc]?.[category];
    if (typeof t === "number") return t;
  }
  return DEFAULT_RATE[category];
}

/**
 * Estimate a campaign's total cost (USD) from a country→count distribution and
 * the template category. When only a SAMPLE of recipients' countries is known,
 * pass the sample distribution + the true total to scale by the sample's
 * average rate (see estimateFromSample).
 */
export function estimateCost(
  countryCounts: Record<string, number>,
  category: TemplateCategory,
): number {
  let total = 0;
  for (const [cc, n] of Object.entries(countryCounts)) {
    total += n * rateFor(cc, category);
  }
  return total;
}

/**
 * Precise-enough estimate when we only sampled some recipient phones: compute
 * the sample's average per-message rate (by country) and apply it to the true
 * `totalRecipients`. For a single-country audience this is exact; for a mixed
 * audience it's a weighted average. `unknown` sample countries fall back to the
 * category default rate.
 */
export function estimateFromSample(
  samplePhones: (string | null | undefined)[],
  totalRecipients: number,
  category: TemplateCategory,
): number {
  const rates = samplePhones.map((p) => rateFor(countryFromPhone(p), category));
  const avg =
    rates.length > 0
      ? rates.reduce((a, b) => a + b, 0) / rates.length
      : DEFAULT_RATE[category];
  return totalRecipients * avg;
}
