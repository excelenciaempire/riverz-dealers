import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Channel,
  ChannelConnection,
  Contact,
  Conversation,
  Message,
} from '@/types';
import { getAdapter } from '@/lib/channels/registry';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent, AiTone, BusinessHours } from './types';

/**
 * 24/7 AI customer-service responder. Called fire-and-forget by
 * inbox-writer after an inbound customer message is persisted. Picks
 * the best matching agent for the (workspace, channel) pair, decides
 * whether to reply (assignment / hours / escalation rules), generates
 * a response with full conversation context, and sends it through the
 * channel's adapter. Every attempt is logged to ai_replies.
 *
 * Never throws — failures are logged and swallowed so the inbox stays
 * unaffected if the AI provider is down.
 */
export async function runAiAgent(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    channel: Channel;
    conversation: Conversation;
    contact: Contact;
    connection: ChannelConnection;
    inboundMessage: Message;
  },
): Promise<void> {
  try {
    const agent = await pickAgent(db, args.workspaceId, args.channel);
    if (!agent) return;

    const skip = shouldSkip(agent, args);
    if (skip) {
      await logReply(db, agent, args, { status: 'skipped', skip_reason: skip });
      return;
    }

    if (containsEscalationKeyword(agent, args.inboundMessage.content_text ?? '')) {
      await logReply(db, agent, args, {
        status: 'skipped',
        skip_reason: 'escalation_keyword',
      });
      return;
    }

    const context = await loadContext(db, args.conversation.id, agent.context_messages);
    const products = await loadProductCatalog(db, agent);
    const reply = await generateReply(agent, args.contact, context, products);
    if (!reply.text) {
      await logReply(db, agent, args, { status: 'skipped', skip_reason: 'empty_reply' });
      return;
    }

    if (agent.reply_delay_seconds > 0) {
      await sleep(agent.reply_delay_seconds * 1000);
    }

    const adapter = getAdapter(args.channel);
    const sendResult = await adapter.sendText({
      channel: args.channel,
      connection: args.connection,
      conversation: args.conversation,
      contact: args.contact,
      text: reply.text,
    });

    const { data: persistedMessage } = await db
      .from('messages')
      .insert({
        conversation_id: args.conversation.id,
        channel: args.channel,
        sender_type: 'bot',
        content_type:
          args.channel === 'gmail' || args.channel === 'outlook'
            ? 'email'
            : args.channel === 'fb_comment' || args.channel === 'ig_comment'
              ? 'comment'
              : 'text',
        content_text: reply.text,
        message_id: sendResult.externalMessageId,
        status: sendResult.status ?? 'sent',
      })
      .select()
      .single();

    await db
      .from('conversations')
      .update({
        last_message_text: reply.text.slice(0, 200),
        last_message_at: new Date().toISOString(),
        last_sender_type: 'bot',
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.conversation.id);

    await logReply(db, agent, args, {
      status: 'sent',
      message_id: (persistedMessage as { id: string } | null)?.id ?? null,
      prompt_tokens: reply.promptTokens,
      completion_tokens: reply.completionTokens,
    });
  } catch (err) {
    console.error('[ai] runner failed:', err);
    try {
      const agent = await pickAgent(db, args.workspaceId, args.channel);
      if (agent) {
        await logReply(db, agent, args, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch {
      /* swallow */
    }
  }
}

async function pickAgent(
  db: SupabaseClient,
  workspaceId: string,
  channel: Channel,
): Promise<AiAgent | null> {
  // channel-scoped agents win over workspace-scoped ones; within each
  // scope, higher priority + most recently updated wins.
  const { data: rows } = await db
    .from('ai_agents')
    .select('*, ai_agent_channels(channel)')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false });

  if (!rows) return null;
  for (const row of rows as (AiAgent & {
    ai_agent_channels: { channel: Channel }[];
  })[]) {
    if (row.scope === 'channels') {
      const channels = (row.ai_agent_channels ?? []).map((c) => c.channel);
      if (channels.includes(channel)) return row;
    }
  }
  for (const row of rows as AiAgent[]) {
    if (row.scope === 'workspace') return row;
  }
  return null;
}

function shouldSkip(
  agent: AiAgent,
  args: { conversation: Conversation; inboundMessage: Message },
): string | null {
  if (!agent.reply_when_assigned && args.conversation.assigned_agent_id) {
    return 'conversation_assigned';
  }
  if (args.conversation.status === 'closed') return 'conversation_closed';
  if (!agent.reply_outside_hours && !withinBusinessHours(agent.business_hours)) {
    return 'outside_hours';
  }
  return null;
}

function containsEscalationKeyword(agent: AiAgent, text: string): boolean {
  const kws = agent.escalate_keywords ?? [];
  if (!kws.length || !text) return false;
  const t = text.toLowerCase();
  return kws.some((k) => k && t.includes(k.toLowerCase()));
}

function withinBusinessHours(hours: BusinessHours | null): boolean {
  if (!hours) return true;
  try {
    const now = new Date();
    // We just match the wall-clock the formatter renders in the
    // configured tz — good enough for "9:00-18:00" type windows.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const dayMap: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekday = fmt.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    const hh = fmt.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = fmt.find((p) => p.type === 'minute')?.value ?? '00';
    const nowMin = Number(hh) * 60 + Number(mm);
    const windows = hours.windows[dayMap[weekday]] ?? [];
    return windows.some((w) => {
      const [from, to] = w.split('-');
      if (!from || !to) return false;
      const [fh, fm] = from.split(':').map(Number);
      const [th, tm] = to.split(':').map(Number);
      const fMin = (fh || 0) * 60 + (fm || 0);
      const tMin = (th || 0) * 60 + (tm || 0);
      return nowMin >= fMin && nowMin < tMin;
    });
  } catch {
    return true;
  }
}

interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function loadContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number,
): Promise<ContextMessage[]> {
  const safeLimit = Math.max(1, Math.min(40, limit || 10));
  const { data } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  const rows = ((data ?? []) as { sender_type: string; content_text: string | null }[])
    .filter((m) => m.content_text && m.content_text.trim())
    .reverse();
  return rows.map((m) => ({
    role: m.sender_type === 'customer' ? 'user' : 'assistant',
    content: m.content_text!.trim(),
  }));
}

const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  friendly: 'Conversa con calidez. Usa frases cortas. Evita formalismos rígidos.',
  formal: 'Mantén un registro profesional y formal. Usa "usted".',
  casual: 'Sé directo y cercano. Permítete frases coloquiales.',
  concise: 'Responde en una o dos frases. Sin saludos. Solo lo necesario.',
};

interface ReplyResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

async function loadProductCatalog(
  db: SupabaseClient,
  agent: AiAgent,
): Promise<ProductRow[]> {
  // Workspace = Riverz "tenant" — modeled as user_id on shopify_products.
  // The owner of the agent is the workspace owner, which lives in
  // workspaces.owner_id. Resolve to user_id once.
  const { data: ws } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', agent.workspace_id)
    .maybeSingle();
  const userId = (ws as { owner_id?: string } | null)?.owner_id;
  if (!userId) return [];

  if (agent.product_scope === 'specific') {
    const { data: links } = await db
      .from('ai_agent_products')
      .select('product_id')
      .eq('agent_id', agent.id);
    const ids = ((links ?? []) as { product_id: string }[]).map((l) => l.product_id);
    if (ids.length === 0) return [];
    const { data: products } = await db
      .from('shopify_products')
      .select('title, description, price_min, price_max, url, product_type, vendor, tags')
      .in('id', ids);
    return (products ?? []) as ProductRow[];
  }

  // Scope = 'all' — cap at the 80 most-recently-synced rows so the
  // system prompt stays inside Anthropic's budget. Workspaces with
  // bigger catalogs should switch the agent to 'specific'.
  const { data: products } = await db
    .from('shopify_products')
    .select('title, description, price_min, price_max, url, product_type, vendor, tags')
    .eq('user_id', userId)
    .order('synced_at', { ascending: false })
    .limit(80);
  return (products ?? []) as ProductRow[];
}

interface ProductRow {
  title: string;
  description: string | null;
  price_min: number | null;
  price_max: number | null;
  url: string | null;
  product_type: string | null;
  vendor: string | null;
  tags: string[] | null;
}

async function generateReply(
  agent: AiAgent,
  contact: Contact,
  context: ContextMessage[],
  products: ProductRow[],
): Promise<ReplyResult> {
  if (agent.provider !== 'anthropic') {
    throw new Error(`Provider ${agent.provider} not implemented`);
  }
  const apiKey =
    (agent.api_key_encrypted ? safeDecrypt(agent.api_key_encrypted) : null) ||
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing Anthropic API key (workspace key or ANTHROPIC_API_KEY).');
  }

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt(agent, contact, products);

  // Ensure the conversation starts with a user turn — required by the API.
  let messages: ContextMessage[] = context;
  while (messages.length && messages[0].role !== 'user') {
    messages = messages.slice(1);
  }
  if (messages.length === 0) {
    messages = [{ role: 'user', content: contact.name ? `Hola, soy ${contact.name}.` : 'Hola.' }];
  }

  const response = await client.messages.create({
    model: agent.model || 'claude-haiku-4-5-20251001',
    max_tokens: Math.max(64, Math.min(2048, Math.ceil((agent.max_response_chars || 500) / 2))),
    system,
    messages,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const trimmed =
    text.length > agent.max_response_chars
      ? text.slice(0, agent.max_response_chars).trimEnd() + '…'
      : text;

  return {
    text: trimmed,
    promptTokens: response.usage?.input_tokens,
    completionTokens: response.usage?.output_tokens,
  };
}

function buildSystemPrompt(
  agent: AiAgent,
  contact: Contact,
  products: ProductRow[],
): string {
  const lines: string[] = [];
  if (agent.persona) lines.push(agent.persona.trim());
  lines.push(TONE_INSTRUCTIONS[agent.tone]);
  lines.push(`Responde en ${agent.language || 'es'}.`);
  lines.push(`Mantente bajo ${agent.max_response_chars} caracteres.`);
  if (agent.knowledge && agent.knowledge.trim()) {
    lines.push('Contexto adicional sobre el negocio:');
    lines.push(agent.knowledge.trim());
  }
  if (products.length > 0) {
    lines.push(
      `Catálogo de productos${agent.product_scope === 'specific' ? ' (asignados a este asistente)' : ''}:`,
    );
    lines.push(products.map(formatProductLine).join('\n'));
  }
  const knownContact: string[] = [];
  if (contact.name) knownContact.push(`Nombre: ${contact.name}`);
  if (contact.email) knownContact.push(`Correo: ${contact.email}`);
  if (contact.phone) knownContact.push(`Teléfono: ${contact.phone}`);
  if (contact.company) knownContact.push(`Empresa: ${contact.company}`);
  if (knownContact.length) {
    lines.push('Datos del cliente que ya conocés:');
    lines.push(knownContact.join(' · '));
  }
  lines.push(
    'Si la consulta requiere intervención humana (precios complejos, reembolsos, queja seria), pedile amablemente al cliente que espere a que un agente humano se conecte.',
  );
  return lines.join('\n\n');
}

function formatProductLine(p: ProductRow): string {
  const price =
    p.price_min != null
      ? p.price_min === p.price_max
        ? `$${p.price_min}`
        : `$${p.price_min}-${p.price_max}`
      : null;
  const meta = [p.product_type, p.vendor, price].filter(Boolean).join(' · ');
  const desc = (p.description ?? '').slice(0, 180);
  return `- ${p.title}${meta ? ` (${meta})` : ''}${desc ? ` — ${desc}` : ''}${
    p.url ? ` <${p.url}>` : ''
  }`;
}

function safeDecrypt(value: string): string | null {
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logReply(
  db: SupabaseClient,
  agent: AiAgent,
  args: { workspaceId: string; conversation: Conversation; inboundMessage: Message },
  patch: {
    status: 'sent' | 'skipped' | 'failed';
    skip_reason?: string;
    error?: string;
    message_id?: string | null;
    prompt_tokens?: number;
    completion_tokens?: number;
  },
): Promise<void> {
  await db.from('ai_replies').insert({
    agent_id: agent.id,
    workspace_id: args.workspaceId,
    conversation_id: args.conversation.id,
    message_id: patch.message_id ?? args.inboundMessage.id ?? null,
    status: patch.status,
    skip_reason: patch.skip_reason ?? null,
    error: patch.error ?? null,
    prompt_tokens: patch.prompt_tokens ?? null,
    completion_tokens: patch.completion_tokens ?? null,
  });
}
