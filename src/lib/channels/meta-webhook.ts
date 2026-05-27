import type { ChannelConnection } from "@/types";

/**
 * Meta webhook handshake echo.
 *
 * Meta only lets you configure ONE verify token per webhook field in
 * the developer dashboard, but our adapter layer is multi-tenant — so
 * we accept either:
 *
 *   - `META_WEBHOOK_VERIFY_TOKEN` env var (the global token you paste
 *     into the dev portal), or
 *   - `connection.webhook_secret` (the per-connection token used when
 *     a workspace rotates its own secret).
 *
 * Returns the `hub.challenge` to echo back on success, or `null` to
 * 403 the request.
 */
export function verifyMetaHandshake(
  req: Request,
  connection: ChannelConnection,
): string | null {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token) return null;
  const globalToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (globalToken && token === globalToken) return challenge;
  if (connection.webhook_secret && token === connection.webhook_secret)
    return challenge;
  return null;
}
