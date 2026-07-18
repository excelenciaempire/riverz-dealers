import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshMLToken } from "./adapter";
import type { ChannelConnection } from "@/types";

const ML = "https://api.mercadolibre.com";

/**
 * Reconciliation backstop for MercadoLibre. ML notifications carry no body and
 * are lost if the token was momentarily dead, so this poll pulls the seller's
 * UNANSWERED questions and re-ingests them (idempotent on externalMessageId).
 * Post-sale messages arrive via the webhook; questions are the reliably
 * pollable surface. Wired via cron-mercadolibre-poll.
 */
export async function pollAllMercadoLibreConnections(): Promise<{
  total: number;
  ingested: number;
}> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "mercadolibre")
    .eq("status", "connected");
  const conns = (data ?? []) as ChannelConnection[];
  let ingested = 0;

  for (const conn of conns) {
    try {
      const sellerId = String((conn.config as Record<string, unknown> | null)?.seller_id ?? "");
      if (!sellerId) continue;
      const token = await getFreshMLToken(conn);
      const r = await fetch(
        `${ML}/questions/search?seller_id=${sellerId}&status=UNANSWERED&api_version=4&limit=50`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!r.ok) continue;
      const j = (await r.json()) as {
        questions?: Array<{
          id?: number;
          text?: string;
          item_id?: string;
          date_created?: string;
          from?: { id?: number };
          buyer_id?: number;
        }>;
      };
      for (const q of j.questions ?? []) {
        if (!q.id || !q.text) continue;
        await ingestInboundEvent(db, {
          channel: "mercadolibre",
          connection: conn,
          externalContactId: String(q.from?.id ?? q.buyer_id ?? "ml"),
          externalMessageId: `q:${q.id}`,
          externalThreadId: `q:${q.id}`,
          subject: q.item_id ? `Pregunta · ${q.item_id}` : undefined,
          text: q.text,
          receivedAt: q.date_created ?? new Date().toISOString(),
          raw: q,
        });
        ingested++;
      }
    } catch (err) {
      console.error("[mercadolibre/poll] failed for", conn.id, err);
    }
  }
  return { total: conns.length, ingested };
}
