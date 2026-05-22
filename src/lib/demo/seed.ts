/**
 * Demo-mode seed data. Used when NEXT_PUBLIC_DEMO_MODE=true to drive
 * the UI without a live Supabase project. Plain in-memory data —
 * intentionally tiny so the inbox feels real without becoming a
 * full fixture project.
 */

import type {
  Channel,
  ChannelConnection,
  Contact,
  Conversation,
  Message,
  MessageTemplate,
  Profile,
  Tag,
  Workspace,
  WorkspaceMember,
} from "@/types";

export const DEMO_USER_ID = "demo-user-id";
export const DEMO_WORKSPACE_ID = "demo-workspace-id";

export const DEMO_PROFILE: Profile = {
  id: "demo-profile-id",
  user_id: DEMO_USER_ID,
  full_name: "Demo Admin",
  email: "demo@unified-inbox.local",
  avatar_url: undefined,
  role: "user",
  created_at: new Date().toISOString(),
};

export const DEMO_WORKSPACE: Workspace = {
  id: DEMO_WORKSPACE_ID,
  name: "Demo Workspace",
  slug: "demo",
  owner_id: DEMO_USER_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const DEMO_MEMBERSHIP: WorkspaceMember = {
  id: "demo-member-id",
  workspace_id: DEMO_WORKSPACE_ID,
  user_id: DEMO_USER_ID,
  role: "admin",
  joined_at: new Date().toISOString(),
};

const HOUR = 3_600_000;

export const DEMO_TAGS: Tag[] = [
  { id: "t-vip", workspace_id: DEMO_WORKSPACE_ID, name: "VIP", color: "#a78bfa", created_at: new Date().toISOString() },
  { id: "t-lead", workspace_id: DEMO_WORKSPACE_ID, name: "Lead", color: "#38bdf8", created_at: new Date().toISOString() },
  { id: "t-soporte", workspace_id: DEMO_WORKSPACE_ID, name: "Soporte", color: "#fb7185", created_at: new Date().toISOString() },
];

interface DemoSeed {
  contact: Contact;
  conversation: Conversation;
  messages: Message[];
}

function seed(
  i: number,
  channel: Channel,
  contact: Partial<Contact>,
  conversation: Partial<Conversation>,
  messages: Array<Partial<Message> & { content_text: string; sender_type: "customer" | "agent" }>,
): DemoSeed {
  const contactId = `c-${i}`;
  const conversationId = `conv-${i}`;
  const now = Date.now() - i * HOUR;
  const fullContact: Contact = {
    id: contactId,
    workspace_id: DEMO_WORKSPACE_ID,
    channel,
    external_id: contact.external_id ?? contactId,
    phone: contact.phone,
    email: contact.email,
    name: contact.name,
    company: contact.company,
    created_at: new Date(now - HOUR).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const fullConv: Conversation = {
    id: conversationId,
    workspace_id: DEMO_WORKSPACE_ID,
    contact_id: contactId,
    channel,
    connection_id: `conn-${channel}`,
    subject: conversation.subject,
    thread_external_id: conversation.thread_external_id,
    is_ad: conversation.is_ad,
    status: conversation.status ?? "open",
    last_message_text: messages.at(-1)?.content_text?.slice(0, 200),
    last_message_at: new Date(now).toISOString(),
    unread_count: conversation.unread_count ?? 0,
    created_at: new Date(now - HOUR * 2).toISOString(),
    updated_at: new Date(now).toISOString(),
    contact: fullContact,
  };
  const fullMessages: Message[] = messages.map((m, j) => ({
    id: `msg-${i}-${j}`,
    conversation_id: conversationId,
    channel,
    sender_type: m.sender_type,
    content_type: m.content_type ?? "text",
    content_text: m.content_text,
    status: m.sender_type === "agent" ? "delivered" : "delivered",
    created_at: new Date(now - (messages.length - j) * 60_000).toISOString(),
  }));
  return { contact: fullContact, conversation: fullConv, messages: fullMessages };
}

const SEEDS: DemoSeed[] = [
  seed(
    1,
    "whatsapp",
    { name: "Lucía García", phone: "+34 612 345 678", external_id: "34612345678" },
    { status: "open", unread_count: 2 },
    [
      { sender_type: "customer", content_text: "Hola! Vi vuestra crema en Instagram, ¿hacéis envío a Madrid?" },
      { sender_type: "agent", content_text: "¡Hola Lucía! Sí, envío gratis a partir de 30€. ¿Te interesa la promo de bienvenida?" },
      { sender_type: "customer", content_text: "Sí porfa, paso el pedido ahora" },
    ],
  ),
  seed(
    2,
    "instagram",
    { name: "javi.fit", external_id: "ig-1700001", avatar_url: undefined },
    { status: "open", unread_count: 1 },
    [
      { sender_type: "customer", content_text: "Buenas, ¿la suscripción mensual incluye envío?" },
      { sender_type: "agent", content_text: "¡Hola Javi! Sí, 100% incluido. Te paso el link 👉" },
      { sender_type: "customer", content_text: "Perfecto, ya me suscribo" },
    ],
  ),
  seed(
    3,
    "messenger",
    { name: "Carlos Méndez", external_id: "psid-918273645" },
    { status: "pending" },
    [
      { sender_type: "customer", content_text: "¿Cómo cancelo mi pedido #4521?" },
      { sender_type: "agent", content_text: "Hola Carlos, dame un segundo y lo gestiono ahora mismo." },
    ],
  ),
  seed(
    4,
    "gmail",
    { name: "Marina Patel", email: "marina@startup.io", external_id: "marina@startup.io" },
    { status: "open", subject: "Propuesta colaboración", thread_external_id: "gmail-thread-001" },
    [
      {
        sender_type: "customer",
        content_text:
          "Hola equipo,\n\nNos encantaría hablar de una posible colaboración para nuestra próxima campaña. ¿Tenéis algún slot esta semana?\n\nUn saludo,\nMarina",
        content_type: "email",
      },
      {
        sender_type: "agent",
        content_text:
          "¡Hola Marina! Gracias por escribir. Te paso link de calendly: cal.com/demo. Encantados de hablarlo.",
        content_type: "email",
      },
    ],
  ),
  seed(
    5,
    "outlook",
    { name: "Roberto Sánchez", email: "roberto@empresa.es", external_id: "roberto@empresa.es" },
    { status: "open", subject: "Devolución pedido #8821", thread_external_id: "outlook-thread-002" },
    [
      {
        sender_type: "customer",
        content_text: "Buenos días, necesito iniciar la devolución del pedido 8821.",
        content_type: "email",
      },
    ],
  ),
  seed(
    6,
    "ig_comment",
    { name: "claraflor.estilo", external_id: "ig-99876" },
    {
      status: "open",
      subject: "Anuncio crema antiarrugas",
      thread_external_id: "fb-post-9981",
      is_ad: true,
    },
    [
      {
        sender_type: "customer",
        content_text: "@brand ¿Funciona también en piel mixta?",
        content_type: "comment",
      },
    ],
  ),
  seed(
    7,
    "fb_comment",
    { name: "Andrés López", external_id: "fb-44331" },
    {
      status: "closed",
      subject: "Promo verano 25%",
      thread_external_id: "fb-post-2231",
      is_ad: true,
    },
    [
      {
        sender_type: "customer",
        content_text: "¿Hasta qué día dura la promo?",
        content_type: "comment",
      },
      {
        sender_type: "agent",
        content_text: "¡Hola Andrés! Hasta domingo a medianoche 🌞",
        content_type: "comment",
      },
    ],
  ),
];

export const DEMO_CONTACTS: Contact[] = SEEDS.map((s) => s.contact);
export const DEMO_CONVERSATIONS: Conversation[] = SEEDS.map((s) => s.conversation);
export const DEMO_MESSAGES: Message[] = SEEDS.flatMap((s) => s.messages);

export const DEMO_CONNECTIONS: ChannelConnection[] = [
  {
    id: "conn-whatsapp",
    workspace_id: DEMO_WORKSPACE_ID,
    channel: "whatsapp",
    label: "Soporte WhatsApp",
    status: "connected",
    external_account_id: "+34900000000",
    config: { phone_number_id: "demo" },
    secrets: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "conn-instagram",
    workspace_id: DEMO_WORKSPACE_ID,
    channel: "instagram",
    label: "@brand_demo",
    status: "connected",
    external_account_id: "ig-page-demo",
    config: { ig_user_id: "demo" },
    secrets: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "conn-gmail",
    workspace_id: DEMO_WORKSPACE_ID,
    channel: "gmail",
    label: "hola@brand.io",
    status: "connected",
    external_account_id: "hola@brand.io",
    config: { email: "hola@brand.io" },
    secrets: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_TEMPLATES: MessageTemplate[] = [
  {
    id: "tpl-bienvenida",
    workspace_id: DEMO_WORKSPACE_ID,
    name: "bienvenida_es",
    category: "Marketing",
    language: "es",
    body_text: "Hola {{1}}, ¡bienvenido a nuestra tienda! Aquí tienes un 10% en tu primera compra: {{2}}",
    status: "Approved",
    created_at: new Date().toISOString(),
  },
  {
    id: "tpl-envio",
    workspace_id: DEMO_WORKSPACE_ID,
    name: "confirmacion_envio",
    category: "Utility",
    language: "es",
    body_text: "Hola {{1}}, tu pedido {{2}} ya está en camino y llegará el {{3}}. ¡Gracias por confiar!",
    status: "Approved",
    created_at: new Date().toISOString(),
  },
];
