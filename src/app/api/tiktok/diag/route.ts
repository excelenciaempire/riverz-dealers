import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { assertCronAuth } from "@/lib/auth/cron";
import { getFreshTikTokToken } from "@/lib/channels/tiktok_comment/adapter";
import type { ChannelConnection } from "@/types";

const TT = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * TEMPORAL — diagnóstico del canal TikTok. Devuelve la respuesta CRUDA de la
 * API (video/list + comment/list) para entender por qué el poll trae 0
 * comentarios. Protegido con x-cron-secret (AUTOMATION_CRON_SECRET). Borrar
 * una vez resuelto.
 */
export async function GET(req: Request) {
  try {
    assertCronAuth(req, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const db = supabaseAdmin();
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "tiktok_comment")
    .in("status", ["connected", "error", "expired"])
    .limit(1)
    .maybeSingle();
  const conn = data as ChannelConnection | null;
  if (!conn) return NextResponse.json({ error: "no tiktok connection" });

  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const businessId = String(cfg.business_id ?? "");
  const out: Record<string, unknown> = { businessId, username: cfg.username, status: conn.status };

  let token: string;
  try {
    token = await getFreshTikTokToken(conn);
    out.tokenOk = true;
  } catch (err) {
    out.tokenError = err instanceof Error ? err.message : String(err);
    return NextResponse.json(out);
  }
  const headers = { "Access-Token": token };

  // video/list — raw
  const vUrl =
    `${TT}/business/video/list/?business_id=${encodeURIComponent(businessId)}` +
    `&fields=${encodeURIComponent(JSON.stringify(["item_id", "caption", "create_time"]))}` +
    `&max_count=10`;
  const vr = await fetch(vUrl, { headers });
  const vj = await vr.json().catch(() => ({}));
  out.videoList = { httpStatus: vr.status, body: vj };

  // comment/list para el primer video — raw
  const videos = (vj as { data?: { videos?: Array<Record<string, unknown>> } })?.data?.videos ?? [];
  if (videos.length > 0) {
    const videoId = String(videos[0].item_id ?? videos[0].video_id ?? "");
    const cUrl =
      `${TT}/business/comment/list/?business_id=${encodeURIComponent(businessId)}` +
      `&video_id=${encodeURIComponent(videoId)}&max_count=50&sort_field=create_time&sort_order=desc`;
    const cr = await fetch(cUrl, { headers });
    const cj = await cr.json().catch(() => ({}));
    out.commentListFirstVideo = { videoId, httpStatus: cr.status, body: cj };
  }

  return NextResponse.json(out);
}
