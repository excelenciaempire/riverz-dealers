import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

/**
 * Segunda llave del panel de plataforma.
 *
 * Hasta ahora /admin se abría con sólo estar en la lista del equipo. Eso hace
 * que la sesión del navegador SEA el panel: una laptop abierta, una cookie
 * robada o una cuenta del equipo comprometida entran a los ajustes que afectan
 * a todos los comercios. Y la lista incluye cuentas que también son de un
 * comercio, así que ni siquiera es un grupo cerrado.
 *
 * Con esto hacen falta las dos cosas: la sesión de un admin del equipo Y una
 * contraseña que sólo vive en el entorno del servidor. No reemplaza al gate de
 * correo, se suma.
 *
 * La cookie es una firma HMAC con vencimiento — no hay tabla de sesiones que
 * mantener, y cambiar `ADMIN_PANEL_PASSWORD` invalida todas las que haya
 * abiertas, que es exactamente lo que se espera de una contraseña rotada.
 */
const COOKIE = 'riverz_admin_unlock';
/** Doce horas: una jornada. Después vuelve a pedirla. */
const TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  return process.env.ADMIN_PANEL_PASSWORD ?? '';
}

/** Sin contraseña configurada el panel no se abre para nadie. */
export function unlockConfigured(): boolean {
  return secret().trim().length >= 8;
}

function sign(payload: string): string {
  const key = process.env.ENCRYPTION_KEY ?? '';
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${payload}|${secret()}`)
    .digest('base64url');
}

export function issueToken(email: string): string {
  const exp = Date.now() + TTL_MS;
  const payload = `${email}|${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined, email: string): boolean {
  // Sin contraseña configurada no hay nada válido: si no se comprueba acá, un
  // token firmado con el secreto vacío verifica contra el secreto vacío. Hoy
  // `isUnlocked` ya lo corta antes, pero esta función es pública y el próximo
  // que la use no tiene por qué saberlo.
  if (!unlockConfigured()) return false;
  if (!token) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  let payload: string;
  try {
    payload = Buffer.from(body, 'base64url').toString();
  } catch {
    return false;
  }
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // El largo primero: timingSafeEqual LANZA con buffers de distinto tamaño.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const [signedEmail, exp] = payload.split('|');
  if (signedEmail !== email) return false;
  return Number(exp) > Date.now();
}

/** ¿Esta sesión ya puso la contraseña del panel? */
export async function isUnlocked(email: string): Promise<boolean> {
  if (!unlockConfigured()) return false;
  const jar = await cookies();
  return verifyToken(jar.get(COOKIE)?.value, email);
}

export const UNLOCK_COOKIE = COOKIE;
export const UNLOCK_TTL_MS = TTL_MS;

/**
 * Comparación en tiempo constante contra la contraseña del panel. Se compara
 * el hash y no el texto para que dos contraseñas de distinto largo no se
 * distingan por el tiempo de respuesta.
 */
export function passwordMatches(input: string): boolean {
  if (!unlockConfigured()) return false;
  const h = (s: string) => createHmac('sha256', 'riverz-admin').update(s).digest();
  return timingSafeEqual(h(input), h(secret()));
}
