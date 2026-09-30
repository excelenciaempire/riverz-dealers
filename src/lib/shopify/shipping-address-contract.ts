/** Shipping fields only: recipient identity and provider targets cannot be changed through this contract. */
export interface OrderShippingAddress {
  address1:string; address2:string; city:string; province:string; zip:string; countryCode:string
}
const FIELDS = ['address1','address2','city','province','zip','countryCode'] as const
export const SHIPPING_COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ')
export function shippingAddress(raw:unknown):OrderShippingAddress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string,unknown>
  if (Object.keys(value).some(key => !FIELDS.includes(key as typeof FIELDS[number]))) return null
  const address = {} as OrderShippingAddress
  for (const field of FIELDS) {
    const text = value[field]
    if (typeof text !== 'string' || text.length > (field === 'zip' ? 32 : field === 'countryCode' ? 2 : 255) || /[\u0000-\u001f\u007f]/.test(text)) return null
    address[field] = text.replace(/\s+/g,' ').trim()
  }
  if (!address.address1 || !address.city || !SHIPPING_COUNTRIES.includes(address.countryCode)) return null
  return address
}
export interface ProviderShippingAddress {
  address1?:string | null; address2?:string | null; city?:string | null; province?:string | null; zip?:string | null;
  country_code?:string | null; first_name?:string | null; last_name?:string | null; company?:string | null; phone?:string | null
}
export function providerShippingAddress(raw:ProviderShippingAddress | null | undefined):OrderShippingAddress | null {
  if (!raw) return null
  return shippingAddress({ address1:raw.address1 ?? '',address2:raw.address2 ?? '',city:raw.city ?? '',province:raw.province ?? '',zip:raw.zip ?? '',countryCode:raw.country_code ?? '' })
}
export function sameShippingAddress(actual:OrderShippingAddress | null,expected:OrderShippingAddress):boolean {
  const normalize = (value:string) => value.replace(/\s+/g,' ').trim().toLocaleLowerCase('en')
  return !!actual && FIELDS.every(field => normalize(actual[field]) === normalize(expected[field]))
}
export function shippingChangeAllowed(order:{ cancelled_at?:string | null; fulfillment_status?:string | null; fulfillments?:{ status:string }[]; tags?:string }):boolean {
  // A known handoff to Dropi needs its own dispatch check; an empty Shopify fulfillment list cannot prove it is editable.
  return order.cancelled_at === null && order.fulfillment_status === null && Array.isArray(order.fulfillments) && order.fulfillments.every(f => ['cancelled','failure'].includes(f.status)) &&
    !/order\s+sent\s+to\s+dropi/i.test(order.tags ?? '')
}
