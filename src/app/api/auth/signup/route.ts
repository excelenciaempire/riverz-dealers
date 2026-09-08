import { NextResponse } from "next/server";
import { cookies as nextCookies } from "next/headers";
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
import { sendAuthEmail } from "@/lib/auth/email";
import { localizePath } from "@/lib/i18n/routes";

/**
 * POST /api/auth/signup
 *
 * Generates the Supabase confirmation link with per-IP + per-email rate
 * limiting, then delivers it through Resend from Riverz's verified domain.
 * The API only reports success after the mail provider accepts the message.
 *
 * Anti-enumeration: on email collision we do NOT say "already
 * registered". Only the email owner receives that information, with a link
 * to sign in. Password recovery remains an explicit, separate request.
 * Both branches return the same generic response.
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
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      data: { full_name: fullName },
      redirectTo,
    },
  });

  const isCollision =
    error?.code === "email_exists" ||
    error?.code === "user_already_exists" ||
    /already (?:been )?registered|already exists/i.test(error?.message ?? "");

  if (isCollision) {
    // El correo ya tenía cuenta: no se creó nada, así que el código vuelve a
    // estar disponible. Sin esto, tipear mal el correo quemaría la invitación.
    if (codeId) await releaseSignupCode(admin, codeId);

    const loginLink = safeRedirectTo(localizePath('/ingresar', locale));
    if (!loginLink) {
      return NextResponse.json(
        { error: translate(locale, "errAccount.emailDeliveryUnavailable") },
        { status: 503 },
      );
    }

    const loginUrl = new URL(loginLink);
    const next = redirectTo && new URL(redirectTo).searchParams.get('next');
    const safeNext = safeRedirectTo(next || undefined);
    if (safeNext) {
      const target = new URL(safeNext);
      loginUrl.searchParams.set('next', target.pathname + target.search + target.hash);
    }
    const delivery = await sendAuthEmail({
      to: email,
      actionLink: loginUrl.toString(),
      locale,
      kind: "existing_account",
    });
    if (!delivery.ok) {
      return NextResponse.json(
        { error: translate(locale, "errAccount.emailDeliveryUnavailable") },
        { status: 503 },
      );
    }
    return NextResponse.json(genericOk);
  }

  if (error || !data.user?.id || !data.properties?.action_link) {
    if (codeId) await releaseSignupCode(admin, codeId);
    console.error(
      JSON.stringify({
        scope: "auth-signup",
        event: "signup_link_failed",
        code: error?.code ?? "missing_link",
      }),
    );
    return NextResponse.json(
      { error: translate(locale, "errAccount.signupFailed") },
      { status: 400 },
    );
  }

  const delivery = await sendAuthEmail({
    to: email,
    actionLink: data.properties.action_link,
    locale,
    kind: "confirmation",
  });
  if (!delivery.ok) {
    // Si el correo propio no está configurado, Supabase conserva la entrega
    // nativa de confirmaciones. Así cada alta sigue requiriendo verificar el
    // correo y no queda una cuenta pendiente sin forma de activarse.
    if (delivery.reason === "not_configured") {
      const { error: nativeConfirmationError } = await admin.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (!nativeConfirmationError) {
        await completeSignup({
          admin,
          codeId,
          userId: data.user.id,
          email,
          termsVersion: body?.terms_version,
          req,
          phone,
        });
        return NextResponse.json(genericOk);
      }
    }
    // Si el proveedor rechazó el mensaje con certeza, dejamos el alta como si
    // nunca hubiera ocurrido. Un error de red es ambiguo: Resend pudo aceptarlo
    // antes de cortarse la respuesta, así que conservamos la cuenta y el enlace.
    if (delivery.reason !== "network_error") {
      const { error: rollbackError } = await admin.auth.admin.deleteUser(
        data.user.id,
      );
      if (rollbackError) {
        console.error(
          JSON.stringify({
            scope: "auth-signup",
            event: "signup_rollback_failed",
            code: rollbackError.code,
          }),
        );
      }
    }
    if (codeId) await releaseSignupCode(admin, codeId);
    return NextResponse.json(
      { error: translate(locale, "errAccount.emailDeliveryUnavailable") },
      { status: 503 },
    );
  }

  await completeSignup({
    admin,
    codeId,
    userId: data.user.id,
    email,
    termsVersion: body?.terms_version,
    req,
    phone,
  });
  return NextResponse.json(genericOk);
}

async function completeSignup({
  admin,
  codeId,
  userId,
  email,
  termsVersion,
  req,
  phone,
}: {
  admin: ReturnType<typeof supabaseAdmin>;
  codeId: string | null;
  userId: string;
  email: string;
  termsVersion: string | undefined;
  req: Request;
  phone: string;
}) {
  if (codeId) {
    await recordSignupCodeRedemption(admin, { codeId, userId, email });
  }

  // Genuine new account: persist the clickwrap consent (append-only audit row
  // + profile mirror) so we hold proof of who accepted which version, when,
  // and from where. Best-effort: a logging failure must not blow up account
  // creation.
  await recordLegalConsent({
    admin,
    userId,
    email,
    version: termsVersion,
    context: "signup",
    req,
  });

  // La fila de `profiles` la crea el disparador `handle_new_user` (migración
  // 001), que solo copia nombre y correo. El teléfono se escribe acá encima
  // en vez de tocar el disparador: no hace falta migración y el alta sigue
  // funcionando igual si esto falla — el dueño siempre puede cargarlo desde
  // Ajustes → Perfil.
  if (!phone) return;
  const { error: phoneError } = await admin
    .from("profiles")
    .update({ phone })
    .eq("user_id", userId);
  if (phoneError) {
    console.warn(
      `[auth/signup] no se pudo guardar el teléfono de ${userId}: ${phoneError.message}`,
    );
  }
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
