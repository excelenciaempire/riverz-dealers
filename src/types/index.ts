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
  | 'ig_comment'
  | 'mercadolibre'
  | 'tiktok_comment'
  | 'voice'
  | 'webchat';

export const CHANNELS: Channel[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'gmail',
  'outlook',
  'fb_comment',
  'ig_comment',
  'mercadolibre',
  'tiktok_comment',
  'voice',
  'webchat',
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
  /** IANA timezone (e.g. "America/Bogota"). The single "app timezone" that
   *  drives every metric day-boundary and every inbox timestamp. Migration
   *  072. Admins set it in Ajustes → Espacio de trabajo. */
  timezone?: string;
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
  /** RBAC (migration 116): which sidebar sections this member may open.
   *  null/undefined = full access (owners/admins, legacy members). */
  allowed_sections?: string[] | null;
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
  /** RBAC (migration 116): pre-assigned menu access, copied to the member on
   *  accept. null = full access. */
  allowed_sections?: string[] | null;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  avatar_url?: string;
  role: string;
  beta_features?: string[];
  /**
   * Teléfono de la persona (migración 151). Es a donde sale la pregunta cuando
   * Riverz no decide solo — p. ej. un pago informado que no cierra.
   */
  phone?: string | null;
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
  /** wa_id normalizado que Meta devuelve para este número (identidad real de
   *  WhatsApp; el "+54 9" argentino resuelve al mismo wa_id con o sin el 9).
   *  Migración 111. Se usa para deduplicar por identidad. */
  wa_id?: string | null;
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
  /** Segmento enriquecido por IA (label + rasgos), estilo CRM de Blueberry.
   *  Calculado on-demand y cacheado. Migration 069. */
  ai_segment?: {
    label: string;
    traits: string[];
    computed_at: string;
    up_to_message_id?: string | null;
  } | null;
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
  /** Última oferta que eligió el cliente, derivada del pedido de Shopify
   *  por número de unidades (ver buildVarsForOrder). Permite flujos de
   *  recompra distintos por oferta y que la IA la conozca. Migration 084. */
  last_offer_chosen?: string | null;
  /** Cantidad total de unidades del último pedido con oferta. Migration 084. */
  last_offer_units?: number | null;
  /** Cuándo se registró last_offer_chosen. Migration 084. */
  last_offer_at?: string | null;
  /** Cumplimiento Voice AI: si true, este contacto NO recibe llamadas de
   *  IA (opt-out). Lo respeta la cola de llamadas. Migration 113. */
  voice_opt_out?: boolean;
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
  /** Dirección completa: es lo que se muestra en la ficha del contacto y lo
   *  que hace falta para despachar. */
  default_address?: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
    zip?: string | null;
  };
  accepts_marketing?: boolean;
  lifetime_orders?: Array<{
    /** Id del pedido en Shopify. Es lo único que permite abrir ESE pedido en
     *  el admin (`/admin/orders/<id>`); el `name` (#52629) sólo sirve para
     *  buscarlo a mano. */
    id?: string;
    name: string;
    total_price: string | number;
    line_items_titles: string[];
  }>;
}

/**
 * Un pedido del historial de compras del contacto (migración 172).
 * Acumulativo y por plataforma: es lo que la ficha muestra en detalle.
 */
export interface ContactPurchase {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  platform: 'shopify' | 'tiendanube' | 'woocommerce' | 'mercadolibre';
  shop_domain: string | null;
  external_id: string;
  order_number: string | null;
  placed_at: string | null;
  currency: string | null;
  total: number | string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  line_items: Array<{ title: string; quantity: number; price: number | null }>;
  customer_email: string | null;
  customer_phone: string | null;
  created_at: string;
  updated_at: string;
}

/** Las cuentas de compra de un contacto, ya resueltas para mostrar. */
export interface ContactPurchaseSummary {
  /** Pedidos de toda la vida del cliente (lo que informa la tienda). */
  ordersCount: number;
  /** Pedidos que Riverz tiene guardados con detalle. */
  recordedCount: number;
  /** Diferencia entre los dos: pedidos contados y sin detalle. */
  missingDetail: number;
  totalSpent: number;
  currency: string | null;
  averageOrder: number | null;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  daysSinceLast: number | null;
  isRepeat: boolean;
  topProducts: Array<{ title: string; quantity: number }>;
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

/** Por qué la IA dejó el hilo a una persona (migración 122). */
export type NeedsHumanReason =
  | 'escalation_keyword'
  | 'escalate_after_messages'
  | 'flow_handoff'
  /** Cortacircuitos: demasiadas respuestas al mismo contacto en poco
   *  tiempo (migración 178). */
  | 'reply_burst_guard';

export interface Conversation {
  id: string;
  workspace_id: string;
  contact_id: string;
  channel: Channel;
  /** Escalamiento: la IA se apagó y el hilo espera a una persona. NULL = no escaló. */
  needs_human_reason?: NeedsHumanReason | null;
  needs_human_at?: string | null;
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
  /** De qué interacción con TU contenido nació el hilo, cuando no fue un DM
   * normal: 'story_reply' (contestaron tu historia) o 'story_mention' (te
   * mencionaron en la suya). Se estampa una vez y se queda (migración 130).
   * Es lo que lleva estos hilos a la pestaña Comentarios de la bandeja. */
  engagement_kind?: "story_reply" | "story_mention" | null;
  /** Click-to-WhatsApp/Messenger ad referral, stamped once (inbound) when the
   * customer arrived from an ad. camelCase, as written by the adapters.
   * Migration 092 (+ Messenger/IG capture). Drives the "replied to an ad"
   * banner at the top of the thread. */
  ad_referral?: {
    sourceType?: string;
    sourceId?: string;
    ctwaClid?: string;
    sourceUrl?: string;
    headline?: string;
    body?: string;
    mediaType?: string;
  } | null;
  status: ConversationStatus;
  assigned_agent_id?: string;
  last_message_text?: string;
  last_message_at?: string;
  /** Sender type of the most recent message — drives the "needs reply"
   * dot in the inbox row. Maintained by inbox-writer + send-route. */
  last_sender_type?: SenderType;
  /** Estado de entrega del último mensaje si es SALIENTE (sent/delivered/read/
   *  failed), o null si el último es del cliente. Mantiene el tick estilo
   *  WhatsApp en el preview de la bandeja. Trigger, migración 102. */
  last_message_status?: MessageStatus | null;
  /** El último mensaje es un comentario oculto en Instagram/Facebook. Marca el
   *  preview de la bandeja sin tener que abrir la conversación para saberlo.
   *  Disparador, migración 161. */
  last_message_hidden?: boolean | null;
  unread_count: number;
  /** Resumen rodante del historial viejo de esta conversación.
   *  Migration 048. */
  ai_summary?: string | null;
  /** Último message.id cubierto por ai_summary. Migration 048. */
  ai_summary_up_to_message_id?: string | null;
  /** Timestamp del último refresh de ai_summary. Migration 048. */
  ai_summary_updated_at?: string | null;
  /** Follow-ups enviados en la racha de silencio actual. Migration 079. */
  followup_count?: number;
  /** Timestamp del último follow-up enviado. Migration 079. */
  followup_last_at?: string | null;
  /** Toggle manual del asistente IA en este chat. Migration 082. Default
   *  true; si está en false, la IA no responde en esta conversación. */
  ai_enabled?: boolean;
  /** Último relleno del historial desde la plataforma (Meta Graph).
   *  Migration 120 — limita la frecuencia de /api/conversations/:id/sync. */
  synced_at?: string | null;
  /** Cuándo el asistente envió un link de checkout (pago pendiente).
   *  Migration 081. NULL = sin checkout pendiente / ya pagado. */
  pending_checkout_at?: string | null;
  /** Link de checkout enviado, para reenviarlo en la recuperación de pago.
   *  Migration 081. */
  pending_checkout_url?: string | null;
  /** Soft-delete: cuándo se borró de la bandeja. Migration 085. NULL = viva.
   *  El borrado marca esto en vez de hacer DELETE físico, para conservar los
   *  messages (métricas por fecha) y el watermark de dedup del ingest. */
  deleted_at?: string | null;
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
  /** Texto crudo del motivo que informó Meta cuando status='failed' (o null si
   *  Meta no informó). La bandeja lo traduce vía error_code (deliveryErrors). */
  error_reason?: string | null;
  /** Código de error de Meta cuando status='failed' (migración 111). */
  error_code?: number | null;
  /** Retenido por pacing de plantilla (held_for_quality_assessment): aún no
   *  entregado ni fallado. Migración 111. */
  held_for_quality?: boolean | null;
  /** Marcado por el watchdog cuando quedó en 'sent' pasado el TTL sin que Meta
   *  confirme entrega ni informe fallo. Migración 111. */
  delivery_unconfirmed_at?: string | null;
  created_at: string;
  reply_to_message_id?: string;
  interactive_reply_id?: string;
  /** Botones resueltos del mensaje saliente (plantilla/interactivo) para
   *  renderizarlos en la bandeja. URL con destino final ya resuelto (short
   *  link), no el placeholder {{1}}. Migración 112. */
  buttons?: MessageButton[] | null;
  /** FB/IG comments: whether the comment is currently hidden on the platform.
   *  Persisted (migration 095) so the state survives reloads and syncs across
   *  panes; written by /api/messages/moderate. */
  is_hidden?: boolean;
  /** Comentarios: si la cuenta del comercio le puso me gusta. Persistido
   *  (migración 169) porque el botón nacía siempre apagado; lo escriben
   *  /api/messages/moderate y el poll de TikTok, que lee el estado real. */
  is_liked?: boolean | null;
  /** Funcionalidad que envió el mensaje (migración 143): 'ai_agent',
   *  'automation', 'flow', 'broadcast', 'comment_ai'… null = lo escribió una
   *  persona. Ver src/lib/inbox/message-origin.ts. */
  origin?: string | null;
  /** Nombre de la pieza concreta que lo envió (la automatización, el flujo, la
   *  campaña, el agente), fotografiado al momento del envío. Migración 143. */
  origin_name?: string | null;
}

/** Un botón resuelto de un mensaje saliente (plantilla/interactivo) tal como
 *  se guarda en `messages.buttons` y se muestra en la burbuja. */
export interface MessageButton {
  /** 'URL' abre un enlace; 'QUICK_REPLY'/'PHONE_NUMBER' se muestran informativos. */
  type: 'URL' | 'QUICK_REPLY' | 'PHONE_NUMBER' | string;
  text: string;
  /** Destino final (short link ya resuelto) para botones URL. */
  url?: string;
  /** Teléfono para botones PHONE_NUMBER. */
  phone_number?: string;
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
  // ── Salud de WhatsApp (migraciones 058 + 111) ──
  /** Tier de mensajería del WABA (TIER_50 … TIER_UNLIMITED). */
  messaging_limit_tier?: string | null;
  /** Calidad del número (GREEN/YELLOW/RED). */
  quality_rating?: string | null;
  /** Veredicto agregado de Meta: AVAILABLE / LIMITED / BLOCKED. */
  health_can_send?: string | null;
  /** account_review_status del WABA. */
  health_review_status?: string | null;
  /** Motivos bloqueantes legibles del último chequeo de salud. */
  health_blockers?: {
    entity: string;
    code: number | null;
    description: string;
    solution: string | null;
  }[] | null;
  /** Cuándo se leyó por última vez la salud. */
  health_checked_at?: string | null;
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
  /** Estado crudo de Meta (APPROVED/PAUSED/DISABLED/…) — preserva PAUSED/DISABLED
   *  que `status` colapsa a Rejected. Migración 111. */
  meta_status?: string | null;
  /** Calidad de la plantilla: UNKNOWN/GREEN/YELLOW/RED. UNKNOWN = nueva sin
   *  historial (elegible a pacing). Migración 111. */
  quality_score?: string | null;
  /** Example value for each {{n}} variable (index 0 = {{1}}). Shown in
   *  previews so the user knows what each variable represents. */
  variable_samples?: (string | null)[];
  meta_template_id?: string;
  /** WABA the template belongs to (templates are WABA-scoped in Meta). Stamped
   *  on sync so switching numbers hides the previous WABA's catalog. */
  waba_id?: string | null;
  /** Campo dinámico declarado por cada variable {{n}}: { "1": "customer_name" }.
   *  Las automatizaciones lo usan para pre-mapear las variables. */
  variable_fields?: Record<string, string> | null;
  created_at: string;
}

/** A free-text "/" canned reply (migration 096). Distinct from MessageTemplate
 *  (Meta HSM) — plain text inserted into the composer, no approval/variables. */
export interface MessageSnippet {
  id: string;
  workspace_id: string;
  shortcut: string;
  title?: string | null;
  body: string;
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
  | 'shopify_order_paid'
  | 'shopify_order_fulfilled'
  | 'shopify_order_delivered'
  | 'shopify_order_cancelled'
  | 'shopify_order_refunded'
  // Time-based variants discovered by the dedicated cron jobs, NOT by
  // a generic time_based scheduler. Both use trigger_config.days_after
  // (post_delivery_feedback) or days_threshold (customer_inactive) as
  // the cadence — see /api/cron/shopify-feedback and
  // /api/cron/reengagement.
  | 'post_delivery_feedback'
  | 'customer_inactive'
  // Pago rechazado en Mercado Pago. Un rechazo NO crea pedido en Shopify,
  // así que no lo ve ningún webhook de comercio: lo empuja la hoja de
  // contabilidad a /api/integrations/mercadopago/rejected y lo dispara el
  // cron `mercadopago-recovery` (nunca un webhook en vivo).
  | 'payment_rejected'
  // Fires after a Voice AI call finishes (any terminal status). The
  // trigger_event carries call.outcome/status/duration/summary so a
  // follow-up automation can branch (e.g. no_answer → WhatsApp).
  // Emitted by the voice result endpoint, NOT by a cron scheduler.
  | 'voice_call_completed';

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
  | 'close_conversation'
  // Enqueue a Voice AI phone call (Telnyx + LiveKit). Does NOT dial
  // inline — inserts a queued voice_calls row respecting the agent's
  // calling window / limits; the voice-calls cron dispatches it.
  | 'voice_call';

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

/**
 * Filtro de plataforma para los activadores de pedido y carrito.
 *
 * Un pedido de Tiendanube dispara el MISMO activador que uno de Shopify —así
 * fue desde la migración 126— y eso es lo correcto por defecto: la mayoría de
 * los comercios tiene una sola tienda y no quiere pensar en esto.
 *
 * Este filtro existe para el que tiene dos conectadas y necesita mensajes
 * distintos según cuál vendió. Vacío o ausente = todas, que es exactamente el
 * comportamiento que ya tenían las automatizaciones existentes.
 */
export interface StorePlatformTriggerConfig {
  platforms?: Array<'shopify' | 'tiendanube' | 'woocommerce'>;
}

export type AutomationTriggerConfig =
  | StorePlatformTriggerConfig
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
  /**
   * Cómo se llama la etiqueta que este paso debería usar, cuando la receta ya
   * lo sabe. Al guardar se busca por nombre y se crea si falta, y el id
   * resuelto reemplaza al hueco vacío.
   *
   * Existe porque una receta no puede traer el id de una etiqueta de un
   * workspace que todavía no existe, y dejar el hueco vacío obligaba al
   * comercio a inventarle nombre a dos etiquetas antes de poder activar nada.
   * De paso, todos los comercios terminan con el mismo nombre, que es lo que
   * hace que un segmento "carrito-recuperado" signifique lo mismo en todas
   * las cuentas.
   */
  tag_name?: string;
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

/**
 * Las preguntas que el motor sabe contestar.
 *
 * Es un `const` y no sólo un tipo porque hace falta EN EJECUCIÓN: la validación
 * tiene que poder comparar contra la lista real. Sin eso, un sujeto inventado
 * —pasó: `"tag"`— se guardaba sin una queja, el motor caía a su `default:
 * return false`, y la pregunta contestaba que no para siempre sin dejar rastro.
 *
 * `purchased` se evalua EN VIVO contra los pedidos de la tienda, no contra el
 * contexto capturado al disparar; `operand` es la ventana ("3h", "7d").
 * `messaged` dice si ya le mandamos un mensaje nuestro en esa ventana, y deja
 * que un flujo se aparte cuando otro ya habló con esa persona, a la vista y no
 * escondido en un cron. `rejected_open` dice si tiene un pago rechazado sin
 * resolver: un rechazo de tarjeta deja el checkout abierto, así que la misma
 * persona entra por los dos rescates. `order_paid` le pregunta a la tienda en
 * el momento, porque el webhook trae el estado que el pedido tenía al crearse y
 * después de una espera eso ya no dice nada.
 */
export const CONDITION_SUBJECTS = [
  'contact_field',
  'tag_presence',
  'message_content',
  'time_of_day',
  'in_segment',
  'context_var',
  'purchased',
  'messaged',
  'rejected_open',
  'order_paid',
] as const;

export type ConditionSubject = (typeof CONDITION_SUBJECTS)[number];

export interface ConditionStepConfig {
  subject: ConditionSubject;
  /** e.g. field name, tag id, substring, or "HH:mm-HH:mm" depending on subject */
  operand?: string;
  /** For contact_field equals / message_content contains — comparison value */
  value?: string;
  /** Comparison operator for contact_field / context_var. Default 'eq' (string
   *  equality). Numeric ops coerce both sides to numbers. Powers the
   *  multi-case "Bifurcar según…" node (e.g. units >= 4, between 2 and 3). */
  op?: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
  /** Upper bound for op 'between'. */
  value2?: string;
}

export interface SendWebhookStepConfig {
  url: string;
  headers?: Record<string, string>;
  body_template?: string;
}

/** Config for the `voice_call` step: enqueue a Voice AI phone call. */
export interface VoiceCallStepConfig {
  /** Agent that runs the call. Must have voice_enabled. */
  agent_id: string;
  /** Which call script/objective to use. Defaults to 'order_confirmation'
   *  when the trigger is an order, else 'manual'. */
  call_type?: VoiceCallType;
  /** Optional one-off objective that overrides the agent's configured
   *  voice_objectives[call_type].objective for this automation. */
  objective_override?: string;
  /** How many times to try the call. Falls back to the agent's config.
   *  (There is deliberately no per-step retry DELAY: the gap between
   *  attempts is decided when a call comes back unanswered, from the
   *  agent's `voice_retry_delay_minutes`. A step-level copy was declared
   *  here for a while and no code ever read it.) */
  max_attempts?: number;
  /**
   * Suspend the run until the call reaches its final state, then continue
   * with `call_status` / `call_outcome` / `call_duration` / `call_summary`
   * available as data points — so "llamar; si no contesta, mandar WhatsApp"
   * works in ONE automation.
   *
   * Undefined means the OLD fire-and-forget behavior: the nodes that already
   * exist in production were built against it, and flipping them silently
   * would change what live automations do. The builder writes `true` on every
   * node it creates from now on.
   */
  wait_for_result?: boolean;
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
  | VoiceCallStepConfig
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

// ============================================================
// Voice AI — phone agents (migration 113)
// ============================================================

/** Which script/objective a voice call runs with. */
export type VoiceCallType =
  | 'order_confirmation'
  | 'cart_recovery'
  | 'followup'
  | 'manual'
  | 'inbound';

export type VoiceCallDirection = 'outbound' | 'inbound';

/** Lifecycle of a voice call (queue → dial → talk → terminal). */
export type VoiceCallStatus =
  | 'queued'
  | 'dialing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'busy'
  | 'voicemail'
  | 'canceled';

/** Statuses that mean the call never connected to a human. */
export const VOICE_UNANSWERED_STATUSES: VoiceCallStatus[] = [
  'no_answer',
  'busy',
  'voicemail',
];

/** Structured result the agent reports before hanging up. */
export type VoiceCallOutcome =
  | 'confirmed'
  | 'cancelled_by_customer'
  | 'rescheduled'
  | 'recovered'
  | 'declined'
  | 'callback_requested'
  | 'opt_out'
  | 'no_outcome';

/** In-call upsell config (COD confirmation calls), on order_confirmation. */
export interface VoiceUpsell {
  enabled: boolean;
  /** How the agent should pitch more units / a bundle. */
  offer_text?: string;
  /** Discount to mention (free text, e.g. "15% en la 2da unidad"). */
  discount?: string;
}

/** Per-call-type objective config, stored in ai_agents.voice_objectives. */
export interface VoiceObjective {
  enabled: boolean;
  /** What the agent should accomplish on this call. */
  objective: string;
  /** Extra instructions appended to the voice system prompt. */
  extra_instructions?: string;
  /** Only on order_confirmation: try to upsell during the call. */
  upsell?: VoiceUpsell;
}

export type VoiceObjectives = Partial<Record<VoiceCallType, VoiceObjective>>;

/** Allowed calling window, evaluated in the workspace timezone. */
export interface VoiceCallingHours {
  /** "HH:mm" 24h. */
  start: string;
  /** "HH:mm" 24h. */
  end: string;
  /** ISO weekdays allowed (1 = Monday … 7 = Sunday). */
  days: number[];
}

/** Per-call cost breakdown (estimated in MVP, reconciled later). */
export interface VoiceCallCost {
  stt_usd?: number;
  llm_usd?: number;
  tts_usd?: number;
  telephony_usd?: number;
  total_usd?: number;
  minutes?: number;
}

export interface VoiceCall {
  id: string;
  workspace_id: string;
  agent_id: string;
  contact_id: string;
  conversation_id: string | null;
  automation_id: string | null;
  direction: VoiceCallDirection;
  call_type: VoiceCallType;
  /** E.164 destination (outbound) or caller (inbound). */
  phone: string;
  language: string;
  status: VoiceCallStatus;
  outcome: VoiceCallOutcome | null;
  outcome_details: Record<string, unknown> | null;
  summary: string | null;
  /** Order/cart/objective context interpolated for the call. */
  context: Record<string, unknown>;
  scheduled_at: string;
  attempt: number;
  max_attempts: number;
  parent_call_id: string | null;
  room_name: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  cost: VoiceCallCost | null;
  recording_url: string | null;
  /** Customer city (from the order/shipping context) — per-city analytics. */
  city: string | null;
  /** Extra revenue captured by an in-call upsell (order edit). */
  upsell_amount: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  contact?: Contact;
}

/** Per-workspace voice connection config, stored in
 *  channel_connections.config for the channel='voice' row. */
export interface VoiceConnectionConfig {
  /** Merchant's own DID in E.164 (caller ID + inbound target). */
  phone_number?: string;
  /** ISO country of the number (e.g. "CO", "MX"). */
  country?: string;
  /** Telnyx id of the workspace's provisioned number (self-serve). Lets us
   *  release the exact number later. */
  telnyx_number_id?: string;
  /** Regulated countries: the submitted Telnyx requirement group + its review
   *  status (approved | pending-approval | declined | …). Ordering waits for
   *  `approved`. */
  regulatory_group_id?: string;
  regulatory_status?: string;
  /** Whether inbound calls are answered by the agent. */
  inbound_enabled?: boolean;
  /** Monthly cap of talk minutes; null/0 = unlimited. */
  monthly_minutes_limit?: number | null;
  /** Emergency stop: when true, no calls are dispatched. */
  kill_switch?: boolean;
  /** Record calls. */
  recording_enabled?: boolean;
  /**
   * Avisar EN VOZ ALTA que la llamada puede ser grabada (se antepone al saludo).
   * Apagado por defecto. Ojo: varias jurisdicciones exigen el aviso para poder
   * grabar (en EE.UU., los estados de consentimiento de ambas partes —
   * California, Florida, Pensilvania…—; también el RGPD en la UE).
   */
  recording_disclosure?: boolean;
  /** E.164 number the agent can warm/cold-transfer a call to (human handoff). */
  transfer_number?: string;
  /** Segundos de espera antes de que el agente hable (0–10; sin apuro para el cliente). */
  greeting_delay_seconds?: number;
  /** Segundos de silencio del cliente antes de avisar "¿sigues ahí?" y luego colgar
   *  (0 = desactivado; default 8). */
  silence_timeout_seconds?: number;
  /** Quién habla primero en llamadas ENTRANTES (default 'customer': el que llamó). */
  inbound_first_speaker?: 'agent' | 'customer';
  /** Quién habla primero en llamadas SALIENTES (default 'agent': saluda el bot). */
  outbound_first_speaker?: 'agent' | 'customer';
  // ── COD / dropshipping mode (opt-in; off for normal merchants) ──
  /** Master toggle for the COD confirmation surface (write-back, Dropi, etc.). */
  cod_mode?: boolean;
  /** Write the call outcome back to the Shopify order as a tag. */
  order_writeback?: {
    enabled?: boolean;
    /** Tag applied when outcome=confirmed (default "Confirmado"). */
    confirmed_tag?: string;
    /** Tag applied when outcome=cancelled/declined (default "Cancelado"). */
    cancelled_tag?: string;
  };
  /** Anti-duplicate window for auto-enqueued calls, in HOURS (default 0.25 = 15 min;
   *  COD merchants set 12 to group multiple same-contact orders into one call). */
  dedupe_hours?: number;
}

/** Bulk outbound call campaign over a saved segment (migration 116). */
export type VoiceCampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'canceled';

export interface VoiceCampaign {
  id: string;
  workspace_id: string;
  agent_id: string;
  name: string;
  segment_id: string | null;
  call_type: VoiceCallType;
  objective: string | null;
  status: VoiceCampaignStatus;
  scheduled_at: string | null;
  stats: {
    total?: number;
    enqueued?: number;
    last_contact_id?: string | null;
    done?: boolean;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Configuración del chat web, guardada en `channel_connections.config` de la
 * fila channel='webchat' (una por comercio, migración 171).
 *
 * Nada de esto es secreto: el visitante lo recibe al abrir el widget. La llave
 * pública que instala el comercio se deriva por HMAC del workspace, así que no
 * hay credencial que guardar (ver `src/lib/channels/webchat/token.ts`).
 */
export interface WebchatConfig {
  /** El widget responde. Apagado = el snippet queda inerte sin desinstalarlo. */
  enabled?: boolean;
  /** Agente de IA que atiende. Ausente = lo elige `pickAgent` como en todo canal. */
  agent_id?: string | null;
  /** Color de marca del launcher y las burbujas propias (#RRGGBB). */
  primary_color?: string;
  position?: 'right' | 'left';
  /** Primer mensaje que ve quien abre el chat. No se guarda como mensaje: es
   *  cartelería, y guardarlo abriría una conversación por cada visitante que
   *  solo mira. */
  greeting?: string;
  /** Nombre y avatar que ve el visitante (la marca, no el agente). */
  brand_name?: string;
  avatar_url?: string;
  /**
   * Dominios donde el widget puede arrancar. Es el control de acceso real:
   * la llave pública viaja en el HTML de la tienda, así que quien la copie
   * solo puede usarla desde estos orígenes. Vacío = ninguno (el snippet trae
   * el dominio propuesto al instalar).
   */
  allowed_domains?: string[];
  /** Pedir email antes de escribir. Off por defecto: la fricción mata la
   *  conversación, y el email igual se captura solo si la persona compra. */
  require_email?: boolean;
}
