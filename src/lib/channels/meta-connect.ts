import { encrypt } from "./encryption";
import { discoverMetaAccounts, subscribePageToWebhooks } from "./meta-graph";
import type { supabaseAdmin } from "./admin-client";
import type { Channel } from "@/types";

/**
 * Shared Meta connection persistence — discover the pages / IG accounts a
 * user token can manage, write one channel_connections row per account, and
 * subscribe each to the right webhook fields. Used by both the OAuth
 * redirect callback and the Facebook-Login-for-Business JS SDK flow
 * (/api/connections/meta/sdk-connect), so the two paths stay identical.
 */

export class MetaConnectError extends Error {}

export interface PersistMetaResult {
  saved: number;
  subscribed: number;
}

export async function persistMetaConnections(
  admin: ReturnType<typeof supabaseAdmin>,
  opts: {
    accessToken: string;
    channel: Channel;
    workspaceId: string;
    userId: string;
    baseSecrets?: Record<string, unknown>;
    /** When set, only persist accounts whose external_account_id (or
     *  config.page_id) is in this list — the page-picker flow. Absent =
     *  persist everything (legacy behavior). */
    pageIds?: string[];
  },
): Promise<PersistMetaResult> {
  const { accessToken, channel, workspaceId, userId, baseSecrets = {}, pageIds } = opts;

  let discovered;
  try {
    discovered = await discoverMetaAccounts(accessToken, channel);
  } catch (err) {
    console.error(`[meta-connect] discovery failed:`, err);
    throw new MetaConnectError("could not list pages/accounts");
  }
  if (pageIds && pageIds.length > 0) {
    const wanted = new Set(pageIds.map(String));
    discovered = discovered.filter(
      (a) => wanted.has(a.external_account_id) || wanted.has(String(a.config.page_id)),
    );
  }
  if (discovered.length === 0) {
    throw new MetaConnectError(
      channel === "instagram" || channel === "ig_comment"
        ? "no IG Professional accounts found on your pages"
        : "no manageable pages or accounts found",
    );
  }

  let saved = 0;
  let subscribed = 0;
  for (const account of discovered) {
    const secrets = {
      ...baseSecrets,
      access_token: encrypt(account.page_access_token),
      user_access_token: encrypt(accessToken),
    };
    const { error: insErr } = await admin.from("channel_connections").insert({
      workspace_id: workspaceId,
      channel,
      label: account.label,
      status: "connected",
      external_account_id: account.external_account_id,
      config: account.config,
      secrets,
      created_by: userId,
    });
    if (insErr && insErr.code !== "23505") {
      // 23505 (duplicate) is fine — admin reconnected the same account.
      console.error(`[meta-connect] insert failed for ${account.label}:`, insErr);
      continue;
    }
    saved++;

    // Crear también la conexión hermana de COMENTARIOS de esta cuenta
    // (messenger→fb_comment, instagram→ig_comment). Sin esta fila, el webhook
    // de comentarios (page feed / instagram comments) no se puede atribuir a
    // ninguna conexión y se descarta. Misma cuenta, mismo token (la respuesta
    // al comentario usa el page token).
    const commentSibling =
      channel === "messenger"
        ? "fb_comment"
        : channel === "instagram"
          ? "ig_comment"
          : null;
    if (commentSibling) {
      const { error: cErr } = await admin.from("channel_connections").insert({
        workspace_id: workspaceId,
        channel: commentSibling,
        label: account.label,
        status: "connected",
        external_account_id: account.external_account_id,
        config: account.config,
        secrets,
        created_by: userId,
      });
      if (cErr && cErr.code !== "23505") {
        console.error(
          `[meta-connect] comment-sibling insert failed for ${account.label}:`,
          cErr,
        );
      }
    }

    if (channel !== "whatsapp") {
      const pageId = String(account.config.page_id ?? account.external_account_id);
      const igUserId = account.config.ig_user_id as string | undefined;
      try {
        await subscribePageToWebhooks({
          channel,
          pageId,
          pageAccessToken: account.page_access_token,
          igUserId,
        });
        subscribed++;
      } catch (err) {
        console.warn(`[meta-connect] subscribe failed for ${account.label}:`, err);
      }
    }
  }

  return { saved, subscribed };
}
