import { NextResponse } from "next/server";
import { cookies as nextCookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  clientIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { safeRedirectTo } from "@/lib/auth/redirect";
import { recordLegalConsent } from "@/lib/legal/consent";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { signupsOpen } from "@/lib/auth/signups";
import { pendingInstallExists, CLAIM_COOKIE as SHOPIFY_CLAIM_COOKIE } from "@/lib/shopify/pending-install";
import { TN_CLAIM_COOKIE } from "@/lib/commerce/tiendanube-claim-cookies";
import {
  claimSignupCode,
  releaseSignupCode,
  recordSignupCodeRedemption,
} from "@/lib/auth/signup-codes";
import { sanitizePhoneForMeta, isValidE164 } from "@/lib/whatsapp/phone-utils";

/**
 * POST /api/auth/signup
 *
 * Wraps supabase.auth.signUp with per-IP + per-email rate limiting so
 * the auth page can keep its UX (browser-driven) while we still cap
 * mass-registration probes. The verification email goes out through
 * Supabase as usual.
 *
 * Anti-enumeration: on email collision we do NOT say "already
 * registered". Instead we silently fire a password-reset email to that
 * address (so the real owner can recover the account) and return the
 * same generic message used on a normal sign-up. Probes can't tell the
 * two branches apart.
 *
 * Código de invitación: el alta está abierta pero no es pública. Hace falta un
 * código emitido por el equipo (migración 209), que se reserva ANTES de crear
 * la cuenta y se devuelve si el alta no llega a existir. Las excepciones son el
 * comercio que llega instalando desde una tienda de aplicaciones y la persona
 * invitada al equipo de un comercio: en las dos ya hay una invitación.
 */

export async function POST(req: Request) {
  const locale = await getLocale();

  // No alcanza con que exista la cookie: el token tiene que corresponder a una
  // instalación estacionada y vigente, o inventarse la cookie sería suficiente
  // para saltarse tanto el cierre como el código.
  const cookies = await nextCookies();
  const reclamo =
    cookies.get(TN_CLAIM_COOKIE)?.value ?? cookies.get(SHOPIFY_CLAIM_COOKIE)?.value;
  const instalando =
    Boolean(reclamo) && (await pendingInstallExists(supabaseAdmin(), reclamo!));

  if (!signupsOpen() && !instalando) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.signupsClosed") },
      { status: 403 },
    );
  }

  const genericOk = {
    ok: true,
    message: translate(locale, "errAccount.signupGenericOk"),
  } as const;

  const body = (await req.json().catch(() => null)) as
    | {
        email?: string;
        password?: string;
        full_name?: string;
        phone?: string;
        accept_terms?: boolean;
        terms_version?: string;
        redirect_to?: string;
        invite_code?: string;
        /** Token de invitación de equipo, si vino por `/invitacion/<token>`. */
        invite_token?: string;
      }
    | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  const fullName = body?.full_name?.trim() ?? "";
  // El teléfono es el canal por el que la plataforma le escribe al dueño
  // cuando el asistente necesita una decisión. Se guarda normalizado (solo
  // dígitos, como lo quiere Meta) para no depender de cómo lo tipeó cada uno.
  const phone = sanitizePhoneForMeta(body?.phone?.trim() ?? "");

  // Compliance gate: an account cannot be created without an explicit,
  // affirmative acceptance of the Terms & Privacy Policy. This is
  // independent of whether the email exists, so a hard 400 here leaks
  // nothing (preserves the anti-enumeration design below).
  if (body?.accept_terms !== true) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.mustAcceptTerms") },
      { status: 400 },
    );
  }

  // Mismo criterio que la aceptación de términos: es un rechazo por forma del
  // dato, igual para un correo existente que para uno nuevo, así que no filtra
  // nada sobre si la cuenta existe.
  if (phone && !isValidE164(phone)) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.phoneInvalid") },
      { status: 400 },
    );
  }

  if (!email || !password) {
    return NextResponse.json(genericOk);
  }

  const ip = clientIp(req);
  const ipCheck = checkRateLimit(`auth-signup:ip:${ip}`, RATE_LIMITS.auth);
  if (!ipCheck.success) return rateLimitResponse(ipCheck);
  const emailCheck = checkRateLimit(
    `auth-signup:email:${email}`,
    RATE_LIMITS.auth,
  );
  if (!emailCheck.success) return rateLimitResponse(emailCheck);

  // ── Código de invitación ──
  // Se reserva acá, después del límite de ritmo (si no, probar códigos a
  // ciegas sería gratis) y antes de crear la cuenta. Si el alta no prospera,
  // más abajo se devuelve el uso.
  //
  // Dos altas no lo necesitan: la que llega instalando desde una tienda de
  // aplicaciones, y la de alguien a quien un comercio invitó a su equipo. En
  // las dos ya hay una invitación, sólo que no tiene forma de código.
  const invitadoAlEquipo = await tieneInvitacionDeEquipo(
    body?.invite_token,
    email,
  );
  let codeId: string | null = null;
  if (!instalando && !invitadoAlEquipo) {
    const raw = body?.invite_code?.trim() ?? "";
    if (!raw) {
      return NextResponse.json(
        { error: translate(locale, "errAccount.inviteCodeRequired") },
        { status: 400 },
      );
    }
    codeId = await claimSignupCode(supabaseAdmin(), raw);
    if (!codeId) {
      // Un solo mensaje para inexistente, revocado, vencido y agotado: por
      // fuera son el mismo hecho, y distinguirlos sólo ayudaría a adivinar.
      return NextResponse.json(
        { error: translate(locale, "errAccount.inviteCodeInvalid") },
        { status: 400 },
      );
    }
  }

  // Defence-in-depth: only honor a `redirect_to` whose origin matches
  // this app's own NEXT_PUBLIC_SITE_URL. Anything else (open-redirect
  // attempt) is silently coerced to undefined so Supabase falls back
  // to its project-default Site URL.
  const redirectTo = safeRedirectTo(body?.redirect_to);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: redirectTo,
    },
  });

  // Supabase signals an existing-confirmed-user collision in one of two
  // ways depending on project settings: a hard error, or a "fake" user
  // object with no identities. Either way we treat it as collision and
  // send the real owner a recovery link instead of leaking the fact.
  const isCollision =
    !!error || (data?.user?.identities?.length ?? 1) === 0;
  if (isCollision) {
    // El correo ya tenía cuenta: no se creó nada, así que el código vuelve a
    // estar disponible. Sin esto, tipear mal el correo quemaría la invitación.
    if (codeId) await releaseSignupCode(supabaseAdmin(), codeId);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
  } else if (data?.user?.id) {
    if (codeId) {
      await recordSignupCodeRedemption(supabaseAdmin(), {
        codeId,
        userId: data.user.id,
        email,
      });
    }

    // Genuine new account: persist the clickwrap consent (append-only
    // audit row + profile mirror) so we hold proof of who accepted
    // which version, when, and from where. Best-effort: a logging
    // failure must not blow up account creation.
    await recordLegalConsent({
      admin: supabaseAdmin(),
      userId: data.user.id,
      email,
      version: body?.terms_version,
      context: "signup",
      req,
    });

    // La fila de `profiles` la crea el disparador `handle_new_user` (migración
    // 001), que solo copia nombre y correo. El teléfono se escribe acá encima
    // en vez de tocar el disparador: no hace falta migración y el alta sigue
    // funcionando igual si esto falla — el dueño siempre puede cargarlo desde
    // Ajustes → Perfil.
    if (phone) {
      const { error: phoneError } = await supabaseAdmin()
        .from("profiles")
        .update({ phone })
        .eq("user_id", data.user.id);
      if (phoneError) {
        console.warn(
          `[auth/signup] no se pudo guardar el teléfono de ${data.user.id}: ${phoneError.message}`,
        );
      }
    }
  } else if (codeId) {
    // Ni colisión ni usuario: Supabase no creó nada. El cupo vuelve.
    await releaseSignupCode(supabaseAdmin(), codeId);
  }
  return NextResponse.json(genericOk);
}

/**
 * ¿El correo tiene una invitación de equipo vigente con ese token?
 *
 * Es la otra forma de invitación que ya existía. Se comprueba contra la base
 * —no basta con que la URL traiga un token— y contra el correo que se está
 * registrando, para que un enlace ajeno no sirva de llave.
 */
async function tieneInvitacionDeEquipo(
  token: string | undefined,
  email: string,
): Promise<boolean> {
  if (!token) return false;
  const { data } = await supabaseAdmin()
    .from("workspace_invites")
    .select("email, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.accepted_at) return false;
  if (data.expires_at && new Date(data.expires_at) <= new Date()) return false;
  return (data.email ?? "").trim().toLowerCase() === email;
}
