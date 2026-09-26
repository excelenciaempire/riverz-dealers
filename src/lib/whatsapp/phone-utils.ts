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
 * Argentina: el `9` es lo único que hace marcable un móvil desde el exterior
 * (`+54 9 <área> <número>`), y ni Shopify ni los CSV lo traen de forma
 * consistente. No se puede deducir del número: en formato nacional un móvil sin
 * el `15` se escribe igual que un fijo, y `getType()` viene vacío para AR con la
 * metadata que usa el proyecto. Asumimos **móvil**, porque en un CRM alimentado
 * por WhatsApp y checkouts de Shopify el teléfono del cliente es su celular.
 * Intercambio aceptado: un fijo argentino queda mal marcado — a cambio dejan de
 * fallar todos los móviles sin el 9, que hoy son el caso real (SIP 404).
 *
 * Sólo toca números de 10 dígitos nacionales (el largo de un AR sin el 9); si ya
 * lo trae, o no encaja, lo devuelve tal cual.
 */
function withArgentineMobile9(e164: string): string {
  if (!e164.startsWith('+54') || e164.startsWith('+549')) return e164
  const nacional = e164.slice(3)
  return nacional.length === 10 ? `+549${nacional}` : e164
}

/**
 * Normaliza un número al E.164 **marcable** (CON `+`) para telefonía SIP, antes
 * de llamar. A diferencia de `normalizeToWhatsApp` (que devuelve dígitos sin `+`
 * para la API de Meta), esto devuelve el formato internacional que la operadora
 * necesita para enrutar la llamada.
 *
 * Clave para Argentina: los móviles se marcan internacionalmente como
 * `+54 9 <área> <número>`. libphonenumber ya incluye el `9` en el E.164 de un
 * móvil AR; si por origen inconsistente (Shopify a veces guarda `+5411…` sin el
 * 9) faltara, lo insertamos. Así el sistema decide el formato correcto por país
 * en vez de marcar lo que venga guardado.
 *
 * @param raw            número guardado (E.164, local, o sucio)
 * @param defaultCountry ISO-2 del cliente (del envío Shopify) para números locales
 * @returns E.164 con `+`, o el mejor esfuerzo dígito+`+` si no se pudo parsear
 */
export function normalizeForDialing(
  raw: string | null | undefined,
  defaultCountry?: string | null,
): string {
  if (!raw) return ''
  const region = (defaultCountry || '').trim().toUpperCase()
  const parse = (country?: CountryCode) => {
    try {
      return parsePhoneNumberFromString(String(raw), country)
    } catch {
      return undefined
    }
  }
  // 1) Ya-internacional; 2) con país por defecto (números locales).
  const p =
    parse(undefined) ?? (region.length === 2 ? parse(region as CountryCode) : undefined)
  if (p && p.isValid()) {
    const e164 = p.number // "+54911…"
    return p.country === 'AR' ? withArgentineMobile9(e164) : e164
  }
  // Último recurso: dígitos con `+` (no regresa peor que lo guardado).
  const d = String(raw).replace(/[^\d+]/g, '')
  if (!d) return ''
  return d.startsWith('+') ? d : `+${d}`
}

/**
 * ISO-2 del país de un número ya internacional (`+54 9 11…` o `5491161…`).
 * Se usa para deducir el país del comercio a partir de su propio número y poder
 * así marcar contactos guardados en formato local: sin esa pista, un
 * "11 5808-2948" se marca como `+1 158…` y no entra nunca.
 *
 * @returns ISO-3166 alpha-2, o null si el número no se puede resolver.
 */
export function countryOfPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  try {
    const parsed = parsePhoneNumberFromString(
      s.startsWith('+') ? s : `+${s.replace(/\D/g, '')}`,
    )
    if (parsed && parsed.isValid()) return parsed.country ?? null
  } catch {
    /* junk in, null out */
  }
  return null
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
 * La clave con la que se comparan dos teléfonos: los últimos 8 dígitos, que
 * no cambian entre "+54 9 …", "54 …", "0…" o el número a secas.
 *
 * Con una excepción argentina: el 15 de los celulares. "0351 15 123-4567"
 * termina en "51234567" y el mismo celular en WhatsApp ("5493511234567")
 * termina en "11234567", así que nunca coincidían. Si el número trae señas
 * argentinas (el 54 o el 0 de larga distancia) y le sobran dos dígitos, se le
 * saca el 15 que va después del código de área.
 */
export function claveDeTelefono(raw: string | null | undefined): string | null {
  let d = normalizePhone(raw ?? '')
  if (d.startsWith('00')) d = d.slice(2)
  let argentino = false
  if (d.startsWith('549') && d.length >= 12) {
    d = d.slice(3)
    argentino = true
  } else if (d.startsWith('54') && d.length >= 11) {
    d = d.slice(2)
    argentino = true
  }
  if (d.startsWith('0')) {
    d = d.slice(1)
    argentino = true
  }
  if (argentino && d.length === 12) {
    for (const i of [2, 3, 4]) {
      if (d.slice(i, i + 2) === '15') {
        d = d.slice(0, i) + d.slice(i + 2)
        break
      }
    }
  }
  return d.length >= 8 ? d.slice(-8) : null
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits (see `claveDeTelefono`).
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  const k1 = claveDeTelefono(n1)
  return k1 !== null && k1 === claveDeTelefono(n2)
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Códigos de área canadienses (NANP comparte +1 con EE.UU.). Se usan para NO
 * tratar a Canadá como EE.UU. en el gate de marketing — la pausa de marketing
 * de Meta es SOLO para números de EE.UU.
 */
const CA_AREA_CODES = new Set([
  '204', '226', '236', '249', '250', '257', '263', '289', '306', '343', '354',
  '365', '367', '368', '382', '403', '416', '418', '431', '437', '438', '450',
  '468', '474', '506', '514', '519', '548', '579', '581', '584', '587', '600',
  '604', '613', '639', '647', '672', '683', '705', '709', '742', '753', '778',
  '780', '782', '807', '819', '825', '867', '873', '879', '902', '905',
])

/**
 * ¿El número es de EE.UU. (+1 con área de EE.UU.)? Meta NO entrega plantillas de
 * MARKETING a números de EE.UU. desde el 2025-04-01 (quedan en 'sent' para
 * siempre, sin error). Este gate del lado del cliente evita ese envío fantasma.
 *
 * Aproximación: cualquier +1 de 11 dígitos es EE.UU. SALVO que el código de área
 * sea canadiense. No excluye territorios del Caribe con +1 (809, 787, etc.);
 * son raros para este caso y sobre-bloquear su marketing es aceptable.
 *
 * @param phone dígitos o E.164 (con o sin +).
 */
export function isUsPhone(phone: string): boolean {
  const d = (phone || '').replace(/\D/g, '')
  if (d.length !== 11 || !d.startsWith('1')) return false
  const areaCode = d.slice(1, 4)
  return !CA_AREA_CODES.has(areaCode)
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
