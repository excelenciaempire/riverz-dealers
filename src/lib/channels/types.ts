import type {
  Channel,
  ChannelConnection,
  Contact,
  Conversation,
  Message,
  MessageAttachment,
} from "@/types";

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

  /** Parse a webhook delivery into normalized inbound events. The
   * adapter is responsible for verifying the signature before returning;
   * an unverified payload must throw. */
  parseWebhook(req: Request, connection: ChannelConnection): Promise<InboundEvent[]>;

  /** Some platforms (Meta) issue a GET verification handshake — return
   * the value to echo back, or null if not applicable. */
  verifyWebhookHandshake?(req: Request, connection: ChannelConnection): Promise<string | null>;
}
