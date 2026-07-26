import { supabaseAdmin } from "./admin-client";
import type { Channel, ChannelConnection } from "@/types";

/** Forma del evento `reaction` de Messenger / Instagram DM. */
export interface MetaReactionEvent {
  /** Id del mensaje al que reaccionaron. */
  mid?: string;
  action?: string;
  /** Nombre de la reacción ("love") — respaldo cuando no viene el emoji. */
  reaction?: string;
  emoji?: string;
}

/** Emoji de respaldo cuando Meta manda el nombre de la reacción y no el
 *  carácter (pasa en algunas versiones del webhook de Instagram). */
const REACTION_EMOJI: Record<string, string> = {
  love: "❤️",
  like: "👍",
  care: "🥰",
  haha: "😂",
  wow: "😮",
  sad: "😢",
  angry: "😡",
  smile: "😊",
};

/**
 * Guarda una reacción de un DM de Meta igual que hace WhatsApp: no es un
 * mensaje sino estado por (mensaje, quien reacciona), así que va a
 * `message_reactions` y la burbuja muestra el emoji. Antes se descartaba: el
 * comercio veía el corazón en la app de Meta y no en Riverz.
 *
 * Best-effort — si el mensaje reaccionado todavía no está ingerido, se saltea.
 */
export async function handleMetaReaction(input: {
  channel: Channel;
  connection: ChannelConnection;
  senderId: string;
  recipientId?: string;
  /** Ids propios (página / cuenta IG): distinguen si reaccionó el comercio. */
  selfIds: Set<string>;
  reaction: MetaReactionEvent;
}): Promise<void> {
  const { reaction } = input;
  if (!reaction?.mid) return;
  const db = supabaseAdmin();
  try {
    const { data: target } = await db
      .from("messages")
      .select("id, conversation_id")
      .eq("channel", input.channel)
      .eq("message_id", reaction.mid)
      .limit(1)
      .maybeSingle();
    const t = target as { id: string; conversation_id: string } | null;
    if (!t) return;

    const byBusiness = input.selfIds.has(input.senderId);
    let actorId = input.connection.workspace_id;
    if (!byBusiness) {
      const { data: contact } = await db
        .from("contacts")
        .select("id")
        .eq("workspace_id", input.connection.workspace_id)
        .eq("channel", input.channel)
        .eq("external_id", input.senderId)
        .limit(1)
        .maybeSingle();
      const c = contact as { id: string } | null;
      if (!c) return;
      actorId = c.id;
    }
    const actorType = byBusiness ? "agent" : "customer";

    const emoji =
      reaction.emoji ||
      REACTION_EMOJI[String(reaction.reaction ?? "").toLowerCase()] ||
      "";
    // `unreact` (o sin emoji) = la sacaron.
    if (reaction.action === "unreact" || !emoji) {
      await db
        .from("message_reactions")
        .delete()
        .eq("message_id", t.id)
        .eq("actor_type", actorType)
        .eq("actor_id", actorId);
      return;
    }
    await db.from("message_reactions").upsert(
      {
        message_id: t.id,
        conversation_id: t.conversation_id,
        actor_type: actorType,
        actor_id: actorId,
        emoji,
      },
      { onConflict: "message_id,actor_type,actor_id" },
    );
  } catch (err) {
    console.warn(`[${input.channel}] reacción no guardada:`, err);
  }
}
