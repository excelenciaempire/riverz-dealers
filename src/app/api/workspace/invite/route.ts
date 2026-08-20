import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { invitesOpen } from "@/lib/auth/signups";
import {
  crearInvitacion,
  esEmailValido,
  ErrorDeInvitacion,
} from "@/lib/workspaces/settings";

/**
 * POST /api/workspace/invite
 *
 * Body: { workspace_id: string; email: string; role: 'admin' | 'agent' }
 *
 * Authorization: caller must be an admin of the workspace. Creates a
 * `workspace_invites` row with a 14-day token. The invite email itself
 * is delivered via Supabase Auth's invite-by-email flow (which the
 * frontend stitches to the accept-invite page via the `?invite_token=…`
 * query string). When email delivery is wired in Phase 9, this row
 * becomes the canonical record of pending invites.
 *
 * Lo que se guarda y se entrega vive en `crearInvitacion`: acá quedan la
 * autorización con la sesión y los códigos HTTP. El chat invita llamando a esa
 * misma función, así que las secciones concedidas se deciden en un solo lugar.
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();

  // Sumar equipo sigue vivo en prelanzamiento: lo dispara un admin del
  // workspace hacia un correo puntual, no es alta pública. Interruptor propio
  // por si hay que cortarlo sin tocar el registro.
  if (!invitesOpen()) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.invitesClosed") },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errAccount.unauthorized") },
      { status: 401 },
    );

  const body = (await req.json().catch(() => null)) as
    | {
        workspace_id?: string;
        email?: string;
        role?: "admin" | "agent";
        /** RBAC: pre-assigned menu sections. Omit / null = full access. */
        allowed_sections?: string[] | null;
      }
    | null;
  if (!body?.workspace_id || !body.email?.trim()) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.inviteFieldsRequired") },
      { status: 400 },
    );
  }
  // Surface a clear 400 when the email is malformed. The accept gate
  // does case-insensitive equality, so an invite for "not-an-email"
  // would just be unredeemable. Better to reject up-front.
  if (!esEmailValido(body.email)) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.emailInvalid") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", body.workspace_id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.inviteAdminOnly") },
      { status: 403 },
    );
  }

  try {
    const invitacion = await crearInvitacion(admin, {
      workspaceId: body.workspace_id,
      email: body.email,
      rol: body.role,
      secciones: body.allowed_sections,
      invitadoPor: user.id,
      // El enlace se arma sobre el dominio por el que entró el pedido: en
      // preview o en un dominio propio, el del entorno público sería otro.
      baseUrl: req.url,
    });
    return NextResponse.json({
      ok: true,
      accept_url: invitacion.enlace,
      mail_delivered: invitacion.correoEntregado,
    });
  } catch (e) {
    if (e instanceof ErrorDeInvitacion && e.codigo === "email") {
      return NextResponse.json(
        { error: translate(locale, "errAccount.emailInvalid") },
        { status: 400 },
      );
    }
    return serverError(
      e instanceof ErrorDeInvitacion ? e.causa : e,
      translate(locale, "errAccount.createInviteFailed"),
      400,
    );
  }
}
