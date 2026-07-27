import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { reconcileAllCommentConnections } from "@/lib/channels/comment-sync";
import { pullSelfRepliesAll } from "@/lib/channels/comment-pull";
import { assertCronAuth } from "@/lib/auth/cron";
import { pingCron } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/comment-sync
 *
 * Two-way comment sync (pull side). Re-reads recent comments for every
 * connected FB/IG comment account and converges the stored inbox rows:
 *   - a comment (or our own reply) deleted natively → marked deleted
 *   - a comment hidden / unhidden natively → is_hidden updated
 *   - una respuesta que el comercio escribió DESDE Instagram → entra al hilo
 *     como mensaje saliente (Meta no notifica los comentarios de la propia
 *     cuenta, así que hay que ir a buscarlos)
 * Facebook also gets these in real time via `feed` webhooks; Instagram has no
 * such webhook, so this cron is the ONLY way IG deletions/hides sync back.
 *
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  void pingCron("comment-sync");

  try {
    const db = supabaseAdmin();
    const result = await reconcileAllCommentConnections(db);
    // Best-effort: si el tirón de respuestas propias falla, la reconciliación
    // (borrados / ocultos) ya se aplicó y no se pierde.
    const selfReplies = await pullSelfRepliesAll(db).catch((err) => {
      console.error("[comment-sync] pull de respuestas propias falló:", err);
      return { connections: 0, ingested: 0, seen: 0, detail: [] };
    });
    return NextResponse.json({ ...result, selfReplies }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
