import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { enrichContactFromShopify } from "@/lib/contacts/enrich";
import type { Contact } from "@/types";

/**
 * POST /api/contacts/:id/enrich
 *
 * Trae de Shopify lo que sabemos del cliente —dirección, pedidos, total
 * gastado— y lo guarda en `contacts.shopify_customer_data`.
 *
 * Existía el enriquecimiento, pero sólo se disparaba cuando el agente de IA
 * atendía un mensaje: sobre 2.844 contactos se había intentado 3 veces, así
 * que la ficha del contacto no mostraba una dirección jamás aunque 1.881
 * estuvieran marcados como compradores. Abrir el contacto es el momento
 * exacto en que esos datos importan, así que ahora se piden ahí.
 *
 * El TTL de 24 h vive dentro de `enrichContactFromShopify`: abrir y cerrar la
 * misma ficha no dispara una ronda de llamadas a Shopify.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.missingIdGeneric") },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );
  }

  const admin = supabaseAdmin();
  const { data: contact } = await admin
    .from("contacts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );
  }

  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", (contact as Contact).workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
  }

  try {
    const snapshot = await enrichContactFromShopify(admin, contact as Contact);
    return NextResponse.json({ ok: true, data: snapshot });
  } catch (err) {
    // Que Shopify no conteste no puede romper la ficha: el resto de los datos
    // del contacto ya se están mostrando.
    console.error("[contacts/enrich] falló:", err);
    return NextResponse.json({ ok: false, data: null });
  }
}
