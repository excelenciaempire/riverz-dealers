import { NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/ai/anthropic-client';
import { ESTILO_HUMANO, humanizarTexto } from '@/lib/ai/estilo-humano';
import { claveRechazada, resolveAnthropicKey } from '@/lib/ai/platform-key';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Conversation, Message } from '@/types';

/**
 * Mejorar el borrador del asesor antes de enviarlo.
 *
 * POST /api/ai/improve-text
 *   body: { text: string, conversation_id?: string }
 *   → { text: string }
 *
 * Es una reescritura, no una respuesta: el modelo recibe lo que la persona
 * ya escribió y devuelve ESO MISMO bien redactado. No inventa datos ni
 * cambia el idioma del borrador — quien atiende es quien decide qué decir.
 *
 * Los últimos mensajes de la conversación entran sólo como contexto de tono
 * y trato (a quién le está escribiendo, en qué idioma viene hablando).
 */

/** Techo del borrador. Un mensaje de bandeja no llega ni cerca. */
const MAX_INPUT_CHARS = 4000;

/** Mensajes de contexto que se le pasan al modelo. */
const CONTEXT_MESSAGES = 6;

/**
 * Sonnet y no Haiku.
 *
 * Lo único que hace este botón es sonar a persona, y ahí la diferencia entre
 * un modelo rápido y uno bueno se nota en la primera frase: Haiku corrige la
 * ortografía pero deja el mensaje con olor a formulario. Es una llamada corta
 * y a pedido —no está en el camino de ninguna respuesta automática—, así que
 * el modelo mejor sale casi gratis.
 */
const MODEL = 'claude-sonnet-5';

const SYSTEM = `Reescribes el mensaje que alguien de una tienda está por mandarle a un cliente por chat.
Se lo devuelves como lo habría escrito esa misma persona con más tiempo: bien escrito, pero escrito por una persona.

Qué hacer:
- Arreglar ortografía, tildes, puntuación y concordancia. Eso siempre.
- Que suene a alguien hablando por WhatsApp, no a un correo de empresa ni a un contestador automático. Frases cortas, el orden natural del habla.
- Un toque informal está bien cuando el borrador ya venía así: "dale", "genial", "te cuento", "cualquier cosa me avisas". Si el borrador es serio, no lo aflojes.
- Cálido sin ser meloso: con una cortesía alcanza.
- Varía las fórmulas. Que dos mensajes seguidos no empiecen igual.

Qué NO hacer:
- Nada de "Estimado cliente", "le informamos que", "quedamos atentos", "no dude en", "reciba un cordial saludo", "a la brevedad". Si el borrador lo dice, cámbialo por lo que diría una persona.
- No agregues saludos, despedidas ni firmas que el borrador no tenga.
- No agregues emojis nuevos. Los que ya están se quedan.
- No inventes ni supongas nada: precios, plazos, stock, envíos, promesas.
- No lo alargues. Si el borrador tiene ocho palabras, la respuesta tiene más o menos ocho.
- Sin markdown, sin comillas alrededor, sin explicaciones.
- ${ESTILO_HUMANO}

Idioma: el mismo del borrador. Y el mismo trato: si el borrador habla de tú, sigue de tú; si habla de usted, sigue de usted. Nunca voseo rioplatense (tenés, querés, avisame).

Ejemplos:
"ola como estas kieres compral?" → "¡Hola! ¿Cómo estás? ¿Querías llevarlo?"
"si señor tenemos en stok" → "Sí, lo tenemos en stock."
"estimado cliente le informamos que su pedido sera despachado a la brevedad" → "¡Hola! Tu pedido sale en breve."
"no puedo ayudarte con eso lo siento" → "Uf, con eso no te puedo ayudar. Perdón."
"ya te lo mando espera" → "Ya te lo mando, dame un segundo."

Devuelve únicamente el mensaje reescrito.`;

export async function POST(request: Request): Promise<Response> {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    text?: string;
    conversation_id?: string;
  } | null;
  const text = body?.text?.trim();
  if (!text) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.textRequired') },
      { status: 400 },
    );
  }
  if (text.length > MAX_INPUT_CHARS) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.textTooLong') },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();

  // El workspace sale de la conversación cuando hay una; si no, de la
  // membresía del usuario. Sin workspace no hay clave ni límite de gasto.
  let workspaceId: string | null = null;
  let conversation: Conversation | null = null;
  if (body?.conversation_id) {
    const { data } = await admin
      .from('conversations')
      .select('*')
      .eq('id', body.conversation_id)
      .maybeSingle();
    conversation = (data as Conversation | null) ?? null;
    if (!conversation) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.notFound') },
        { status: 404 },
      );
    }
    workspaceId = conversation.workspace_id;
  } else {
    const { data } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    workspaceId = (data as { workspace_id?: string } | null)?.workspace_id ?? null;
  }
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 },
    );
  }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 },
    );
  }

  const overBudget = await aiBudgetGuard(workspaceId);
  if (overBudget) return overBudget;

  // Con qué clave se paga esto.
  //
  // La del comercio manda, igual que en el resto del producto — pero acá hay
  // una trampa que no existe cuando contesta un agente: este botón no tiene
  // agente. Tomar "la clave de cualquier agente del workspace" hacía que un
  // agente de prueba, apagado y con una clave vieja, se llevara puesta la
  // función entera (401 invalid x-api-key). Así que sólo cuentan las claves de
  // agentes ACTIVOS, y si esa clave no sirve se reintenta con la de la
  // plataforma en vez de devolver un error que el comercio no puede arreglar.
  const { data: agentRow } = await admin
    .from('ai_agents')
    .select('api_key_encrypted')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .not('api_key_encrypted', 'is', null)
    .limit(1)
    .maybeSingle();
  const keys: string[] = [];
  const agentKeyEncrypted =
    (agentRow as { api_key_encrypted?: string | null } | null)
      ?.api_key_encrypted ?? null;
  const withAgent = await resolveAnthropicKey(admin, {
    workspaceId,
    agentKeyEncrypted,
  });
  if (withAgent?.key) keys.push(withAgent.key);
  if (withAgent?.source === 'agent') {
    const platform = await resolveAnthropicKey(admin, { workspaceId });
    if (platform?.key && platform.key !== withAgent.key) keys.push(platform.key);
  }
  if (keys.length === 0) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.missingApiKey') },
      { status: 500 },
    );
  }

  // Contexto: últimos mensajes de texto del hilo, en orden cronológico.
  let context = '';
  if (conversation) {
    const { data: rows } = await admin
      .from('messages')
      .select('sender_type, content_text')
      .eq('conversation_id', conversation.id)
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(CONTEXT_MESSAGES);
    const msgs = ((rows ?? []) as Pick<Message, 'sender_type' | 'content_text'>[])
      .reverse()
      .map(
        (m) =>
          `${m.sender_type === 'customer' ? 'Cliente' : 'Tienda'}: ${(m.content_text ?? '').slice(0, 500)}`,
      );
    if (msgs.length) context = msgs.join('\n');
  }

  const prompt = context
    ? `Conversación hasta ahora (solo como contexto de tono y trato, no la respondas):\n${context}\n\nBorrador a reescribir:\n${text}`
    : `Borrador a reescribir:\n${text}`;

  try {
    let response: Awaited<
      ReturnType<ReturnType<typeof getAnthropic>['messages']['create']>
    > | null = null;
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        response = await getAnthropic(key).messages.create({
          model: MODEL,
          max_tokens: 1200,
          system: SYSTEM,
          messages: [{ role: 'user', content: prompt }],
        });
        break;
      } catch (err) {
        lastErr = err;
        // Sólo se prueba la siguiente clave cuando el problema ES la clave.
        // Un 429 o un 500 del modelo no mejora por cambiar de pagador.
        if (claveRechazada(err)) continue;
        throw err;
      }
    }
    if (!response) throw lastErr ?? new Error('no_key_worked');
    const crudo = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
      // El modelo a veces devuelve el mensaje entre comillas pese a la
      // instrucción; se las sacamos si envuelven todo el texto.
      .replace(/^["“'']([\s\S]+)["”'']$/, '$1');
    const improved = humanizarTexto(crudo);

    if (!improved) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.improveFailed') },
        { status: 502 },
      );
    }
    return NextResponse.json({ text: improved });
  } catch (err) {
    console.error('[improve-text] fallo', err);
    return NextResponse.json(
      { error: translate(locale, 'errAi.improveFailed') },
      { status: 502 },
    );
  }
}
