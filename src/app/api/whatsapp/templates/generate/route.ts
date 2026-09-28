import { getAnthropic } from '@/lib/ai/anthropic-client';
import { esfuerzo } from '@/lib/ai/esfuerzo';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { darFormaAlCuerpo } from '@/lib/templates/forma';
import { OFICIO_PLANTILLA } from '@/lib/templates/oficio';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

/**
 * Draft a WhatsApp template body with Claude from a short brief.
 *
 * Powers the "Generar con IA" toggle in the template builder. Returns a
 * single suggested body string respecting Meta's limits (≤ 1024 chars,
 * sequential {{1}} variables). The user reviews/edits before submitting to
 * Meta — we never auto-submit AI output.
 */

const SYSTEM_PROMPT = `Eres un redactor experto en plantillas de WhatsApp Business (WhatsApp Cloud API).
Escribes el CUERPO de una plantilla de mensaje que Meta debe aprobar.

Reglas estrictas:
- Devuelve SOLO el texto del cuerpo, sin comillas, sin encabezado, sin pie, sin explicaciones.
- Máximo 1024 caracteres. Si necesitas personalización, usa variables correlativas {{1}}, {{2}}… empezando en {{1}}, sin saltos.
- El cuerpo va en dos o tres bloques separados por una línea en blanco. Nunca un solo párrafo.
- No incluyas URLs ni teléfonos en el cuerpo (van en botones).
- Cumple las políticas de Meta: nada engañoso, sin contenido prohibido.
- Responde en el idioma que se indique.
- No incluyas razonamiento ni notas: solo el cuerpo final.

${OFICIO_PLANTILLA}`;

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.notAuthenticated') },
        { status: 401 }
      );
    }

    const limit = checkRateLimit(
      `template-ai:${user.id}`,
      RATE_LIMITS.broadcast
    );
    if (!limit.success) return rateLimitResponse(limit);

    // El saldo, igual que en el resto de los botones de IA. Sin esto, redactar
    // plantillas era el único camino a pedido que gastaba sin puerta.
    const workspaceId = await resolveWorkspaceIdForUser(
      supabaseAdmin(),
      user.id
    );
    // La misma clave que el resto de la IA: una cuenta BYOK paga con la suya.
    const clave = await resolveAnthropicKey(supabaseAdmin(), {
      workspaceId: workspaceId ?? '',
    });
    if (!clave) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.aiNotConfigured') },
        { status: 503 }
      );
    }
    const sinSaldo = await aiBudgetGuard(workspaceId, 'standard');
    if (sinSaldo) return sinSaldo;

    const body = await request.json();
    const brief: string = (body.brief ?? '').toString().trim();
    const language: string = (body.language ?? 'es').toString();
    const category: string = (body.category ?? 'MARKETING').toString();
    const tone: string = (body.tone ?? '').toString().trim();

    if (!brief) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.describeMessage') },
        { status: 400 }
      );
    }

    const client = getAnthropic(clave.key, {
      db: supabaseAdmin(),
      workspaceId: workspaceId ?? '',
      concepto: 'ia_asistencia',
      detalle: { superficie: 'panel', para: 'plantilla' },
      origenDeLaClave: clave.source,
    });

    const userPrompt = [
      `Idioma: ${language}`,
      `Categoría: ${category}`,
      tone ? `Tono: ${tone}` : null,
      `Objetivo / brief del mensaje: ${brief}`,
      '',
      'Escribe el cuerpo de la plantilla.',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 1024,
      // Quick copy task — no thinking, lowest effort. The system prompt forbids
      // reasoning leaking into the visible response.
      ...esfuerzo('claude-sonnet-5-5'),
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!text) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.aiReturnedNoText') },
        { status: 502 }
      );
    }

    // Meta hard-caps the body at 1024 chars; clamp defensively. La forma en
    // bloques no se deja librada al modelo: si volvió un párrafo compacto,
    // `darFormaAlCuerpo` lo parte antes de que llegue al editor, que es el
    // último momento en que corregirlo sale gratis.
    const bodyText = darFormaAlCuerpo(text.slice(0, 1024));

    return NextResponse.json({ success: true, body_text: bodyText });
  } catch (error) {
    console.error('Error generating template with AI:', error);
    const message =
      error instanceof Anthropic.APIError
        ? translate(locale, 'errWhatsapp.claudeApiError', {
            status: error.status ?? '',
            message: error.message,
          })
        : error instanceof Error
          ? error.message
          : translate(locale, 'errWhatsapp.generateMessageFailed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
