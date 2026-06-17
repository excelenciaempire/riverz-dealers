// ============================================================
// Channels — unified inbox taxonomy
// ============================================================
export type Channel =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'gmail'
  | 'outlook'
  | 'fb_comment'
  | 'ig_comment';

export const CHANNELS: Channel[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'gmail',
  'outlook',
  'fb_comment',
  'ig_comment',
];

// ============================================================
// Workspaces — multi-tenant
// ============================================================
export type WorkspaceRole = 'admin' | 'agent';

export interface Workspace {
  id: string;
  name: string;
  slug?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  invited_email?: string;
  invited_by?: string;
  joined_at: string;
  user?: Profile;
}

export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  invited_by: string;
  expires_at: string;
  accepted_at?: string;
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  avatar_url?: string;
  role: string;
  beta_features?: string[];
  /** IANA timezone (e.g. "America/Bogota"). Drives every format() in the inbox. */
  timezone?: string;
  created_at: string;
}

export interface Contact {
  id: string;
  workspace_id: string;
  channel: Channel;
  /** Stable per-channel identifier — phone (whatsapp), PSID (messenger),
   * IG user id (instagram), email address (gmail/outlook), commenter id
   * (fb_comment/ig_comment). */
  external_id?: string;
  phone?: string;
  name?: string;
  email?: string;
  company?: string;
  avatar_url?: string;
  /** True si el contacto fue visto en una orden o customer de Shopify.
   *  Migration 030. La lista de Contactos lo usa para mostrar un badge. */
  is_shopify_customer?: boolean;
  /** Resumen acumulativo (Claude Haiku) de lo que sabemos del cliente —
   *  preferencias, alergias, tono, requests comunes. Migration 049. */
  ai_summary?: string | null;
  /** Cache JSONB del customer en Shopify. Migration 049. */
  shopify_customer_data?: ShopifyCustomerSnapshot | null;
  /** Timestamp del último refresh de shopify_customer_data. Migration 049. */
  shopify_data_synced_at?: string | null;
  /** # de conversaciones que la IA ha atendido para este contacto.
   *  Migration 049. */
  conversation_count?: number;
  /** Última vez que la IA respondió a este contacto. Migration 049. */
  last_ai_conversation_at?: string | null;
  /** Si este contacto comparte teléfono/email con otro del mismo
   *  workspace, apunta al "primario". Migration 050. */
  unified_contact_id?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Snapshot Shopify cacheado en contacts.shopify_customer_data.
 * Refrescado cada 24h por /lib/contacts/enrich.ts.
 */
export interface ShopifyCustomerSnapshot {
  customer_id?: string;
  total_spent?: number;
  currency?: string;
  orders_count?: number;
  last_order_date?: string | null;
  tags?: string[];
  default_address?: {
    country?: string | null;
    city?: string | null;
  };
  accepts_marketing?: boolean;
  lifetime_orders?: Array<{
    name: string;
    total_price: string | number;
    line_items_titles: string[];
  }>;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ContactTag {
  id: string;
  contact_id: string;
  tag_id: string;
}

export interface CustomField {
  id: string;
  workspace_id: string;
  field_name: string;
  field_type: string;
  field_options?: Record<string, unknown>;
  created_at: string;
}

export interface ContactCustomValue {
  id: string;
  contact_id: string;
  custom_field_id: string;
  value?: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  user_id: string;
  note_text: string;
  created_at: string;
}

export type ConversationStatus = 'open' | 'pending' | 'closed';

export interface Conversation {
  id: string;
  workspace_id: string;
  contact_id: string;
  channel: Channel;
  /** Connection that produced this conversation (Meta page, mailbox, …). */
  connection_id?: string;
  /** Email-style subject, or the post/ad title for comment threads. */
  subject?: string;
  /** External thread identifier — Gmail threadId, Graph conversation id, etc. */
  thread_external_id?: string;
  /** True when ≥1 message in this conversation came from an ad creative
   * (resolved via the comments_meta.is_ad → ad_posts lookup). Drives the
   * inbox's "Ads only" filter. */
  is_ad?: boolean;
  status: ConversationStatus;
  assigned_agent_id?: string;
  last_message_text?: string;
  last_message_at?: string;
  /** Sender type of the most recent message — drives the "needs reply"
   * dot in the inbox row. Maintained by inbox-writer + send-route. */
  last_sender_type?: SenderType;
  unread_count: number;
  /** Resumen rodante del historial viejo de esta conversación.
   *  Migration 048. */
  ai_summary?: string | null;
  /** Último message.id cubierto por ai_summary. Migration 048. */
  ai_summary_up_to_message_id?: string | null;
  /** Timestamp del último refresh de ai_summary. Migration 048. */
  ai_summary_updated_at?: string | null;
  created_at: string;
  updated_at: string;
  contact?: Contact;
}

export type SenderType = 'customer' | 'agent' | 'bot';
export type ContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  | 'interactive'
  | 'email'
  | 'comment';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageAttachment {
  url: string;
  mime_type?: string;
  name?: string;
  size?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  channel: Channel;
  sender_type: SenderType;
  sender_id?: string;
  content_type: ContentType;
  content_text?: string;
  /** Email HTML body when content_type === 'email'. */
  html_body?: string;
  /** Email subject when content_type === 'email'. */
  subject?: string;
  media_url?: string;
  /** Categoría del adjunto principal (image/voice/audio/video/document/sticker).
   *  Migration 051. */
  media_type?: 'image' | 'voice' | 'audio' | 'video' | 'document' | 'sticker' | null;
  /** MIME real del adjunto principal. Migration 051. */
  media_mime?: string | null;
  /** Bytes del adjunto principal. Migration 051. */
  media_size?: number | null;
  /** Transcripción cacheada (Whisper) para audios/voice notes. Migration 051. */
  media_transcription?: string | null;
  attachments?: MessageAttachment[];
  template_name?: string;
  message_id?: string;
  status: MessageStatus;
  created_at: string;
  reply_to_message_id?: string;
  interactive_reply_id?: string;
}

export interface CommentMeta {
  message_id: string;
  post_id?: string;
  parent_comment_id?: string;
  ad_id?: string;
  permalink?: string;
  created_at: string;
}

export type ReactionActor = 'customer' | 'agent';

export interface MessageReaction {
  id: string;
  message_id: string;
  conversation_id: string;
  actor_type: ReactionActor;
  actor_id?: string;
  emoji: string;
  created_at: string;
}

// ============================================================
// Channel connections — generic per-channel auth/config
// ============================================================
export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'pending'
  | 'expired';

export interface ChannelConnection {
  id: string;
  workspace_id: string;
  channel: Channel;
  label?: string;
  status: ConnectionStatus;
  external_account_id?: string;
  /** Non-secret per-channel metadata: phone_number_id, page_id, waba_id, … */
  config: Record<string, unknown>;
  /** Encrypted secrets — never expose to the client. */
  secrets?: Record<string, unknown>;
  webhook_secret?: string;
  last_synced_at?: string;
  last_error?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Legacy WhatsApp connection record. Kept for one release cycle; new
 * code should read from {@link ChannelConnection} (channel='whatsapp').
 */
export interface WhatsAppConfig {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  waba_id?: string;
  access_token: string;
  verify_token?: string;
  status: 'connected' | 'disconnected';
  connected_at?: string;
}

export interface MessageTemplate {
  id: string;
  workspace_id: string;
  name: string;
  category: 'Marketing' | 'Utility' | 'Authentication';
  language?: string;
  header_type?: 'text' | 'image' | 'video' | 'document';
  header_content?: string;
  body_text: string;
  footer_text?: string;
  buttons?: Record<string, unknown>[];
  status?: 'Draft' | 'Pending' | 'Approved' | 'Rejected';
  created_at: string;
}

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type RecipientStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed';

export interface Broadcast {
  id: string;
  workspace_id: string;
  name: string;
  template_name: string;
  template_language: string;
  template_variables?: Record<string, unknown>;
  audience_filter?: Record<string, unknown>;
  scheduled_at?: string;
  status: BroadcastStatus;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  created_at: string;
}

export interface BroadcastRecipient {
  id: string;
  broadcast_id: string;
  /**
   * Nullable after migration 004 — becomes NULL when the referenced
   * contact is deleted (ON DELETE SET NULL). History preserved; the
   * UI renders "Unknown" for orphaned rows.
   */
  contact_id: string | null;
  status: RecipientStatus;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  replied_at?: string;
  error_message?: string;
  /**
   * Meta's message id, persisted when the broadcast send succeeds so
   * the webhook can mirror status updates back onto the recipient row.
   * Added in migration 003.
   */
  whatsapp_message_id?: string;
  created_at: string;
  contact?: Contact;
}

// ============================================================
// Automations (migration 006)
// ============================================================

export type AutomationTriggerType =
  | 'new_message_received'
  | 'first_inbound_message'
  | 'keyword_match'
  | 'new_contact_created'
  | 'conversation_assigned'
  | 'tag_added'
  | 'time_based'
  | 'shopify_abandoned_checkout'
  | 'shopify_order_created'
  | 'shopify_order_fulfilled'
  // Time-based variants discovered by the dedicated cron jobs, NOT by
  // a generic time_based scheduler. Both use trigger_config.days_after
  // (post_delivery_feedback) or days_threshold (customer_inactive) as
  // the cadence — see /api/cron/shopify-feedback and
  // /api/cron/reengagement.
  | 'post_delivery_feedback'
  | 'customer_inactive';

export type AutomationStepType =
  | 'send_message'
  | 'send_template'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_conversation'
  | 'update_contact_field'
  | 'wait'
  | 'condition'
  | 'send_webhook'
  | 'close_conversation';

export type AutomationLogStatus = 'success' | 'partial' | 'failed';

export interface KeywordMatchTriggerConfig {
  keywords: string[];
  match_type: 'exact' | 'contains';
  case_sensitive?: boolean;
}

export interface TagTriggerConfig {
  tag_id: string;
}

export interface TimeBasedTriggerConfig {
  /** Cron expression or simple HH:mm string; engine can accept either. */
  schedule: string;
  timezone?: string;
}

/**
 * Trigger config for `post_delivery_feedback` automations: send the
 * customer a survey N days after the order was delivered/fulfilled.
 */
export interface PostDeliveryFeedbackTriggerConfig {
  /** How many whole days after delivery to fire. Required, > 0. */
  days_after: number;
}

/**
 * Trigger config for `customer_inactive` automations: ping a customer
 * whose last order was more than N days ago.
 */
export interface CustomerInactiveTriggerConfig {
  /** Min days since last_order_at to count as "inactive". Required, > 0. */
  days_threshold: number;
}

export type AutomationTriggerConfig =
  | Record<string, never>
  | KeywordMatchTriggerConfig
  | TagTriggerConfig
  | TimeBasedTriggerConfig
  | PostDeliveryFeedbackTriggerConfig
  | CustomerInactiveTriggerConfig
  | Record<string, unknown>;

export interface SendMessageStepConfig {
  text: string;
}

export interface SendTemplateStepConfig {
  template_name: string;
  language?: string;
  variables?: Record<string, string>;
}

export interface TagStepConfig {
  tag_id: string;
}

export interface AssignConversationStepConfig {
  mode: 'specific' | 'round_robin';
  agent_id?: string;
}

export interface UpdateContactFieldStepConfig {
  field: string;
  value: string;
}

export interface WaitStepConfig {
  amount: number;
  unit: 'minutes' | 'hours' | 'days';
}

export type ConditionSubject =
  | 'contact_field'
  | 'tag_presence'
  | 'message_content'
  | 'time_of_day'
  | 'in_segment'
  | 'context_var';

export interface ConditionStepConfig {
  subject: ConditionSubject;
  /** e.g. field name, tag id, substring, or "HH:mm-HH:mm" depending on subject */
  operand?: string;
  /** For contact_field equals / message_content contains — comparison value */
  value?: string;
}

export interface SendWebhookStepConfig {
  url: string;
  headers?: Record<string, string>;
  body_template?: string;
}

export type AutomationStepConfig =
  | SendMessageStepConfig
  | SendTemplateStepConfig
  | TagStepConfig
  | AssignConversationStepConfig
  | UpdateContactFieldStepConfig
  | WaitStepConfig
  | ConditionStepConfig
  | SendWebhookStepConfig
  | Record<string, never>
  | Record<string, unknown>;

export interface Automation {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  /** Optional saved segment that scopes which contacts the trigger fires for. */
  audience_segment_id?: string | null;
  is_active: boolean;
  execution_count: number;
  last_executed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationStep {
  id: string;
  automation_id: string;
  parent_step_id?: string | null;
  branch?: 'yes' | 'no' | null;
  step_type: AutomationStepType;
  step_config: AutomationStepConfig;
  position: number;
  created_at: string;
}

export interface AutomationLogStepResult {
  step_id: string;
  step_type: AutomationStepType;
  status: 'success' | 'skipped' | 'failed';
  detail?: string;
}

export interface AutomationLog {
  id: string;
  automation_id: string;
  workspace_id: string;
  contact_id: string | null;
  trigger_event: string;
  steps_executed: AutomationLogStepResult[];
  status: AutomationLogStatus;
  error_message?: string | null;
  created_at: string;
  contact?: Contact;
}
