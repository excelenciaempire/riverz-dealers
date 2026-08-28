import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Códigos de invitación: la puerta del alta.
 *
 * El registro está abierto, pero no al público — para crear una cuenta hay que
 * traer un código que emitió el equipo desde /admin/codigos. Cada código tiene
 * un cupo y, si se quiere, un vencimiento (migración 209).
 *
 * Reservar y devolver son dos pasos porque el alta puede fallar después de
 * comprobar el código (correo ya registrado, error de Supabase). Se reserva
 * antes de crear la cuenta y se devuelve si no llegó a existir: al revés, dos
 * personas con el mismo código de un solo uso entrarían las dos.
 */

/** Sin vocales ni caracteres que se confunden al dictarlos (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

/**
 * Como lo guarda la base: mayúsculas y solo letras y números.
 *
 * Se muestra en grupos de cuatro (`RIVZ-8K3M`), así que quien lo copia lo
 * escribe con guion. Sacarlos acá hace que las dos formas sean el mismo código.
 */
export function normalizeSignupCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Con el guion del medio, que es como se lee y se dicta. */
export function formatSignupCode(code: string): string {
  const clean = normalizeSignupCode(code);
  if (clean.length !== LENGTH) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

export function generateSignupCode(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export interface SignupCodeRow {
  id: string;
  code: string;
  note: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_by_email: string | null;
  created_at: string;
}

export type SignupCodeStatus = "active" | "used_up" | "expired" | "revoked";

export function signupCodeStatus(row: SignupCodeRow, now = new Date()): SignupCodeStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  if (row.uses >= row.max_uses) return "used_up";
  return "active";
}

/**
 * Toma un uso del código. Devuelve su id, o null si no sirve —no existe, está
 * revocado, venció o se agotó—. Todas esas razones son la misma para quien se
 * registra: el código no vale.
 */
export async function claimSignupCode(
  admin: SupabaseClient,
  raw: string,
): Promise<string | null> {
  const code = normalizeSignupCode(raw);
  if (!code) return null;
  const { data, error } = await admin.rpc("claim_signup_code", { p_code: code });
  if (error) {
    console.warn(`[signup-codes] claim falló: ${error.message}`);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Devuelve el uso reservado. Best-effort: el alta ya falló, esto no puede romper la respuesta. */
export async function releaseSignupCode(
  admin: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await admin.rpc("release_signup_code", { p_id: id });
  if (error) console.warn(`[signup-codes] release falló: ${error.message}`);
}

/** Deja escrito quién consumió el código. */
export async function recordSignupCodeRedemption(
  admin: SupabaseClient,
  params: { codeId: string; userId: string | null; email: string },
): Promise<void> {
  const { error } = await admin.from("signup_code_redemptions").insert({
    code_id: params.codeId,
    user_id: params.userId,
    email: params.email,
  });
  if (error) console.warn(`[signup-codes] redención no registrada: ${error.message}`);
}
