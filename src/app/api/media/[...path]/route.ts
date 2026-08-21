import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import {
  INBOX_SIGNED_TTL_SECONDS,
  signMediaPath,
  storagePathFromSegments,
} from "@/lib/channels/media-url";

/**
 * GET /api/media/<workspace_id>/<conversation_id>/<archivo>
 *
 * Única puerta de lectura de los adjuntos de conversación. El bucket
 * `message-media` es privado desde la migración 141, así que sin esta ruta no
 * hay forma de ver una foto o escuchar una nota de voz.
 *
 * Comprueba sesión y pertenencia al workspace que nombra la propia ruta, y
 * recién ahí redirige a una URL firmada de vida corta. El primer segmento es
 * la autorización: quien pida el adjunto de otro workspace recibe 404, no 403,
 * para no confirmar que el archivo existe.
 *
 * Devuelve 302 en vez del archivo para que los bytes los sirva Supabase y no
 * pasen por el servidor de la app.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;

  // workspace / conversación / archivo. Menos segmentos es una ruta que esta
  // app nunca generó (los objetos derivados viven fuera de este espacio).
  if (!path || path.length < 3) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const [workspaceId] = path;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Antes de consultar nada: si la ruta no es un nombre de archivo nuestro, el
  // primer segmento deja de ser la autorización que este chequeo cree que es.
  const storagePath = storagePathFromSegments(path);
  if (!storagePath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabaseAdmin()
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const signed = await signMediaPath(storagePath, INBOX_SIGNED_TTL_SECONDS);
  if (!signed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Privada y por debajo de la vida de la firma: el navegador reutiliza la
  // redirección un rato sin llegar a servir un enlace ya vencido.
  return NextResponse.redirect(signed, {
    status: 302,
    headers: {
      "Cache-Control": `private, max-age=${INBOX_SIGNED_TTL_SECONDS - 60}`,
    },
  });
}
