/**
 * Detección de teléfonos en el texto de un mensaje, para cualquier canal.
 *
 * Por qué: en Instagram y Messenger no se pueden mandar enlaces con
 * comodidad, así que el cliente termina dejando su número escrito ("3878514146")
 * para seguir por WhatsApp. Instagram muestra ahí mismo el botón para
 * escribirle; la bandeja tiene que ofrecer lo mismo sin obligar a copiar y
 * pegar el número a mano.
 *
 * Pura y sin React a propósito: la valida el test sin montar componentes,
 * igual que `linkify`.
 */

import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js";

export interface PhoneToken {
  /** E.164 con `+` — lo que se manda a la API. */
  e164: string;
  /** Formato internacional legible ("+54 387 851 4146"). */
  display: string;
}

/** Tope de números por mensaje: más que esto es un listado, no un contacto. */
const MAX_PHONES = 3;

/**
 * Números de teléfono válidos dentro del texto.
 *
 * `defaultCountry` es el país del número de WhatsApp del comercio: sin él,
 * un número local ("3878514146") es indistinguible de un id de pedido, y
 * libphonenumber sólo puede resolver los que ya vienen en formato
 * internacional. Se escanea con y sin país para cubrir ambos casos.
 */
export function findPhones(
  text: string | null | undefined,
  defaultCountry?: string | null,
): PhoneToken[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const region = (defaultCountry ?? "").trim().toUpperCase();
  const out = new Map<string, PhoneToken>();

  const scan = (country?: CountryCode): void => {
    try {
      for (const found of findPhoneNumbersInText(raw, country)) {
        const number = found.number;
        if (!number?.isValid()) continue;
        out.set(number.number, {
          e164: number.number,
          display: number.formatInternational(),
        });
        if (out.size >= MAX_PHONES) return;
      }
    } catch {
      /* texto raro — no es motivo para romper la burbuja */
    }
  };

  if (region.length === 2) scan(region as CountryCode);
  if (out.size < MAX_PHONES) scan(undefined);
  return [...out.values()].slice(0, MAX_PHONES);
}

/** País (ISO-3166 alpha-2) del número propio del comercio, para interpretar
 *  los números locales que escriben los clientes. */
export function countryOfBusinessNumber(
  displayPhoneNumber?: string | null,
): string | null {
  const raw = String(displayPhoneNumber ?? "").trim();
  if (!raw) return null;
  try {
    const [found] = [...findPhoneNumbersInText(raw.startsWith("+") ? raw : `+${raw}`)];
    return found?.number?.country ?? null;
  } catch {
    return null;
  }
}
