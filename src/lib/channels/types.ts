import type {
  Channel,
  ChannelConnection,
  Contact,
  Conversation,
  Message,
  MessageAttachment,
} from "@/types";

/**
 * What the unified route forwards to `parseWebhook` once it has read +
 * verified the request body. We pass the parsed JSON, the exact bytes
 * the channel signed (so per-event HMAC re-checks can use the same
 * input the signature was computed over), and the original Request (for
 * URL params, headers — anything that isn't the body). */
export interface ParsedWebhookContext {
  request: Request;
  rawBody: string;
  payload: unknown;
}

/**
 * Inbound event surfaced by an adapter after it parses a webhook payload
 * (or a poller produces one). Channel-agnostic shape — the engine routes
 * these into the unified inbox without caring whether they came from
 * WhatsApp, Instagram, Messenger, Gmail, Outlook, or a FB/IG comment.
 */
export interface InboundEvent {
  channel: Channel;
  /** The channel connection that received this event. */
  connection: ChannelConnection;
  /** Stable per-channel sender identifier — phone (E.164), PSID, IG id,
   * email address, commenter id, etc. */
  externalContactId: string;
  /** Optional human-friendly display name from the channel. */
  contactName?: string;
  contactAvatarUrl?: string;
  /** External message id assigned by the platform — used for dedupe. */
  externalMessageId?: string;
  /** External thread/conversation id — Gmail threadId, Messenger
   * conversation id, etc. Null for one-shot channels (comments). */
  externalThreadId?: string;
  /** Subject line for email channels / post title for comment channels. */
  subject?: string;
  /** Plain-text message body. Always present (even if empty). */
  text: string;
  /** Optional rich HTML body (email channels). */
  htmlBody?: string;
  /** Files / images / docs attached. */
  attachments?: MessageAttachment[];
  /** Comment-channel metadata. */
  comment?: {
    postId?: string;
    parentCommentId?: string;
    adId?: string;
    permalink?: string;
  };
  /** Wall-clock timestamp at the platform. */
  receivedAt: string;
  /** When true this event is something WE sent (e.g. an email pulled
   * from the Sent folder), so it should be stored as an agent message
   * and must not bump the unread counter. `externalContactId` still
   * refers to the customer (the recipient), so the conversation keys
   * correctly. */
  outbound?: boolean;
  /** Raw payload kept for debugging — never echoed to clients. */
  raw?: unknown;
}

export interface OutboundText {
  channel: Channel;
  connection: ChannelConnection;
  conversation: Conversation;
  contact: Contact;
  text: string;
  /** Reply-target — channel-specific id (Meta wamid, Gmail messageId, …). */
  replyToExternalId?: string;
  /** Instagram only — when set, the DM is sent as a PRIVATE REPLY to this
   *  comment id (`recipient: { comment_id }`) instead of to the user's
   *  IGSID. Required to DM someone who only commented (their comment-author
   *  id is not a messageable id). */
  commentId?: string;
}

export interface OutboundTemplate {
  channel: Channel;
  connection: ChannelConnection;
  conversation: Conversation;
  contact: Contact;
  templateName: string;
  language?: string;
  /** Positional template parameters. */
  params?: string[];
}

export interface SendResult {
  /** Channel-assigned id (Meta wamid, Gmail messageId, etc.) — persist on the
   * message row so status callbacks can find the right row. */
  externalMessageId?: string;
  /** Initial status returned by the platform (often `sent`). */
  status?: Message["status"];
}

/**
 * A channel adapter encapsulates everything channel-specific:
 * authentication, outbound sends, inbound webhook parsing, and (where
 * applicable) signature verification. The engine never touches Meta /
 * Google / Microsoft APIs directly — it goes through the adapter.
 */
export interface ChannelAdapter {
  readonly channel: Channel;
  /** Human-readable label shown in the connection wizard. */
  readonly label: string;
  /** True when an admin has not yet provided credentials; the UI uses
   * this to render the "Connect" CTA. */
  isConfigured(connection: ChannelConnection): boolean;

  /** Send a plain-text message. Throws if the channel can't deliver it. */
  sendText(input: OutboundText): Promise<SendResult>;

  /** Optional — only WhatsApp supports HSM templates right now. */
  sendTemplate?(input: OutboundTemplate): Promise<SendResult>;

  /** Parse a webhook delivery into normalized inbound events.
   *
   * The unified route runs `verifyChannelWebhook` before calling here, so
   * the body is already authenticated at the channel-protocol level
   * (Meta HMAC, Gmail push secret, Outlook clientState handshake). The
   * adapter MAY still re-verify per-event signals (e.g. Outlook echoes
   * clientState on each notification), but it is no longer the only line
   * of defense. The `rawBody` is forwarded so adapters that want to
   * re-HMAC can do so without re-buffering the request stream. */
  parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]>;

  /** Some platforms (Meta) issue a GET verification handshake — return
   * the value to echo back, or null if not applicable. */
  verifyWebhookHandshake?(req: Request, connection: ChannelConnection): Promise<string | null>;
}
