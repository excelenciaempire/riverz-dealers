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
  /** Click-to-WhatsApp / ad referral — present when the message came from an
   *  ad (WhatsApp `referral` object). Lets attribution tie a sale to the ad. */
  referral?: {
    sourceType?: string;
    sourceId?: string;
    ctwaClid?: string;
    sourceUrl?: string;
    headline?: string;
    body?: string;
    mediaType?: string;
  };
  /** Sólo trae contexto de anuncio, no un mensaje. Meta manda un evento
   *  `referral` suelto cuando alguien vuelve a escribir desde un anuncio a un
   *  chat que YA existe (el cartel "Este chat contiene una respuesta a …").
   *  Se sella `conversations.ad_referral` y no se inserta ningún mensaje —
   *  nunca crea la conversación si no existe. */
  referralOnly?: boolean;
  /** Wall-clock timestamp at the platform. */
  receivedAt: string;
  /** When true this event is something WE sent (e.g. an email pulled
   * from the Sent folder), so it should be stored as an agent message
   * and must not bump the unread counter. `externalContactId` still
   * refers to the customer (the recipient), so the conversation keys
   * correctly. */
  outbound?: boolean;
  /** When true this is a BACKFILL of past history (WhatsApp coexistence
   * `history` sync), not a live message. Stored normally but must NOT
   * trigger the AI agent / automations — we're importing old chats, not
   * receiving something to answer. */
  historical?: boolean;
  /** When false, only ingest into a conversation that ALREADY exists (and
   *  is live); never create one. Used by the Meta DM backfill, whose job is
   *  filling outbound gaps in existing threads — a piece of old history must
   *  not spawn a brand-new inbox row, and above all must not resurrect a
   *  conversation the user soft-deleted (migración 085). Defaults to true so
   *  real-time webhooks keep opening fresh conversations as before. */
  createIfMissing?: boolean;
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
  /** Instagram & Messenger — when set, the DM is sent as a PRIVATE REPLY to
   *  this comment id (`recipient: { comment_id }`) instead of to the user's
   *  IGSID/PSID. Required to DM someone who only commented (their comment-author
   *  id is not a messageable id). Powers comment-to-DM. */
  commentId?: string;
  /** True when a HUMAN agent (not the AI/automation) is sending from the inbox.
   *  Lets the Messenger/Instagram adapters retry with the HUMAN_AGENT message
   *  tag (7-day window) when a normal DM is rejected for being outside Meta's
   *  24h window. MUST stay unset on every bot/automation path — the tag is only
   *  valid for genuine human agent responses and needs the human_agent permission. */
  humanAgent?: boolean;
}

export interface OutboundMedia {
  channel: Channel;
  connection: ChannelConnection;
  conversation: Conversation;
  contact: Contact;
  /** Public https URL Meta will fetch the asset from (kept reachable). */
  mediaUrl: string;
  mediaType: "image" | "video" | "audio" | "document";
  /** Optional caption — ignored for audio (WhatsApp rejects it). */
  caption?: string;
  /** Filename shown to the recipient — documents only. */
  filename?: string;
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
  /** WhatsApp: the send response's `message_status` was
   *  `held_for_quality_assessment` (template pacing hold). Persisted so the
   *  bubble shows "in quality review" instead of a mute `sent`. */
  heldForQuality?: boolean;
  /** WhatsApp: normalized `wa_id` Meta returned for the recipient. Used to key
   *  the contact by real identity (kills the AR "+54 9" duplicate split). */
  waId?: string;
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

  /** Send a media message (image/video/audio/document). Optional — only
   *  channels that support outbound media implement it. */
  sendMedia?(input: OutboundMedia): Promise<SendResult>;

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
