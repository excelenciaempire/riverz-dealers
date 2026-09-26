/**
 * Alta de un número de WhatsApp en Cloud API, igual para todos los caminos
 * (Embedded Signup, token pegado a mano y el reintento con PIN).
 *
 * Dos modos:
 *   - Coexistencia: el número sigue en la app WhatsApp Business del comercio.
 *     NUNCA se registra: /register lo migra a Cloud API puro y rompe la app.
 *   - Número propio: vive solo en Cloud API. Sin /register no envía nada
 *     (Meta responde 133010 "Account not registered").
 */
import { randomInt } from 'node:crypto';
import { withAppsecretProof } from '@/lib/channels/meta-graph';

const GRAPH = 'https://graph.facebook.com/v25.0';

export type FlujoDeAlta = 'coexistencia' | 'nuevo';

export interface DatosDelNumero {
  is_on_biz_app?: boolean;
  platform_type?: string;
}

/**
 * ¿Es coexistencia? Manda lo que dice Meta del número; si no lo dice, el
 * evento del popup (FINISH = número nuevo, FINISH_WHATSAPP_BUSINESS_APP_
 * ONBOARDING = coexistencia); y si tampoco hay evento, se asume coexistencia,
 * porque no registrar se arregla y registrar por error rompe la app.
 */
export function esCoexistencia(
  numero: DatosDelNumero | null,
  flujo?: FlujoDeAlta | null,
): boolean {
  if (numero?.is_on_biz_app === true) return true;
  if ((numero?.platform_type ?? '').toUpperCase() === 'SMB_APP') return true;
  if (numero?.is_on_biz_app === false) return false;
  if (flujo === 'nuevo') return false;
  return true;
}

/** Solo un número propio que todavía no está en Cloud API necesita /register. */
export function necesitaRegistro(coexistencia: boolean, platformType?: string | null): boolean {
  return !coexistencia && (platformType ?? '').toUpperCase() !== 'CLOUD_API';
}

/** PIN de verificación en dos pasos, uno por número (antes era "000000" para todos). */
export function pinNuevo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export type ResultadoRegistro =
  | { ok: true }
  | { ok: false; error: string; pinDistinto: boolean };

/** El número ya tenía verificación en dos pasos con otro PIN. */
export function esPinDistinto(error: string): boolean {
  return /\b133005\b|pin mismatch|two.step/i.test(error);
}

export async function registrarNumero(args: {
  phoneNumberId: string;
  token: string;
  pin: string;
}): Promise<ResultadoRegistro> {
  try {
    const res = await fetch(withAppsecretProof(`${GRAPH}/${args.phoneNumberId}/register`, args.token), {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin: args.pin }),
    });
    if (res.ok) return { ok: true };
    const error = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error, pinDistinto: esPinDistinto(error) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error, pinDistinto: false };
  }
}
