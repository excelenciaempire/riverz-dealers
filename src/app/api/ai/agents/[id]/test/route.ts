import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent, AiTone } from '@/lib/ai/types';

/**
 * Smoke-test an AI agent without involving any channel. Generates a
 * reply for the supplied user message using the agent's persona,
 * knowledge, tone, and provider config, and returns it as JSON.
 *
 * POST /api/ai/agents/[id]/test
 *   body: { message: string }
 */
const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  friendly: 'Conversa con calidez. Usa frases cortas. Evita formalismos rígidos.',
  formal: 'Mantén un registro profesional y formal. Usa "usted".',
  casual: 'Sé directo y cercano. Permítete frases coloquiales.',
  concise: 'Responde en una o dos frases. Sin saludos. Solo lo necesario.',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { message?: string } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from('ai_agents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (agent as AiAgent).workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const a = agent as AiAgent;
  try {
    const apiKey =
      (a.api_key_encrypted ? safeDecrypt(a.api_key_encrypted) : null) ||
      process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Falta la API key (workspace o ANTHROPIC_API_KEY del servidor).' },
        { status: 500 },
      );
    }

    const lines: string[] = [];
    if (a.persona) lines.push(a.persona.trim());
    lines.push(TONE_INSTRUCTIONS[a.tone] ?? '');
    lines.push(`Responde en ${a.language || 'es'}.`);
    lines.push(`Mantente bajo ${a.max_response_chars} caracteres.`);
    if (a.knowledge?.trim()) {
      lines.push('Contexto adicional:');
      lines.push(a.knowledge.trim());
    }
    const system = lines.filter(Boolean).join('\n\n');

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: a.model || 'claude-haiku-4-5-20251001',
      max_tokens: Math.max(64, Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2))),
      system,
      messages: [{ role: 'user', content: message }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return NextResponse.json({
      reply: text,
      usage: {
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI call failed' },
      { status: 502 },
    );
  }
}

function safeDecrypt(value: string): string | null {
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}
