import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize a raw phone (any format, possibly a bare LOCAL number with no
 * country code) into the WhatsApp-ready digits-only E.164 form (no `+`),
 * using `defaultCountry` as the region when the number lacks a country code.
 *
 * This is the fix for numbers that came from Shopify in local format. e.g. an
 * Argentine buyer who typed "3516501221" (Córdoba) or "11 5630-9090" (Buenos
 * Aires) — `sanitizePhoneForMeta` would leave those at 10 digits with NO `+54`,
 * so WhatsApp can never reach them. With `defaultCountry='AR'` libphonenumber
 * resolves them to the full international number (incl. the AR mobile `9`).
 *
 * Strategy, in order, so we never regress an already-working number:
 *   1. Parse WITH `defaultCountry` — handles bare local numbers.
 *   2. Parse WITHOUT a country — handles already-international input
 *      ("+54 9 351…", "0054…").
 *   3. Fall back to the legacy digits-only sanitize.
 *
 * @param raw            phone string from the source (Shopify / CSV / form)
 * @param defaultCountry ISO-3166 alpha-2 of where they bought ('AR','CO','MX'…),
 *                       usually the order's shipping/billing `country_code`.
 * @returns digits-only E.164 (no `+`), or '' when nothing usable.
 */
export function normalizeToWhatsApp(
  raw: string | null | undefined,
  defaultCountry?: string | null,
): string {
  if (!raw) return ''
  const region = (defaultCountry || '').trim().toUpperCase()

  const tryParse = (country?: CountryCode): string => {
    try {
      const parsed = parsePhoneNumberFromString(String(raw), country)
      if (parsed && parsed.isValid()) return parsed.number.replace(/^\+/, '')
    } catch {
      /* malformed input — fall through */
    }
    return ''
  }

  // 1) With the purchase country (best for bare local numbers).
  if (region.length === 2) {
    const withCountry = tryParse(region as CountryCode)
    if (withCountry) return withCountry
  }
  // 2) Without a country (already-international input).
  const international = tryParse(undefined)
  if (international) return international
  // 3) Never regress: legacy digits-only form.
  return sanitizePhoneForMeta(String(raw))
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}

/**
 * Classify a Meta WhatsApp send error so the broadcast cron can stop
 * retrying dead numbers and stop burning quality rating.
 *
 *   transient            — try again next time (rate-limited / timeout).
 *   invalid_recipient    — number isn't on WhatsApp (131026 / 131047).
 *   spam_blocked         — quality block (131048 / 131056); treat as
 *                          permanent for this contact to protect the
 *                          WABA's quality rating.
 *   sandbox_not_allowed  — sandbox allow-list (131030) — already handled
 *                          by isRecipientNotAllowedError; kept here for
 *                          completeness.
 *   other                — unclassified; left as failed without flag.
 */
export type MetaErrorClass =
  | 'transient'
  | 'invalid_recipient'
  | 'spam_blocked'
  | 'sandbox_not_allowed'
  | 'other'

export function classifyMetaError(message: string): MetaErrorClass {
  if (!message) return 'other'
  if (/131030|not in (the )?allowed list/i.test(message)) return 'sandbox_not_allowed'
  if (/131026|131047|incapable of receiving/i.test(message)) return 'invalid_recipient'
  if (/131048|131056|spam rate|paired/i.test(message)) return 'spam_blocked'
  if (/131000|131005|rate limit|timeout|temporar/i.test(message)) return 'transient'
  return 'other'
}

/**
 * Human-friendly phone for the UI: "+54 9 11 6758 0888" instead of the raw
 * stored digits ("5491167580888"). Falls back to the input untouched when it
 * can't be parsed (short codes, junk) — never returns empty for a non-empty
 * input. Display-only: storage/APIs keep using the digits-only E.164 form.
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = String(raw).trim()
  try {
    const parsed = parsePhoneNumberFromString(s.startsWith('+') ? s : `+${s.replace(/\D/g, '')}`)
    if (parsed && parsed.isValid()) return parsed.formatInternational()
  } catch {
    /* junk in, junk out */
  }
  return s
}
