import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from '@/lib/ai/anthropic-client';
import { pickModel } from './model';
import { latestInboundText } from './engagement';

/**
 * Lead scoring del Agente de Instagram.
 *
 * Clasifica el engagement de cada persona (su comentario/DM de origen) en
 * intención de compra, sentimiento y spam, usando el modelo de triage (rápido
 * y barato) en lote. El resultado prioriza a quién contactar primero y filtra
 * spam/haters — el "lead scoring" que Blueberry hace y nuestra heurística por
 * recencia no.
 */

export type LeadScore = 'high' | 'medium' | 'low';
export type LeadSentiment = 'positive' | 'neutral' | 'negative';

export interface ScoredLead {
  score: LeadScore;
  sentiment: LeadSentiment;
  spam: boolean;
}

const SCORE_SYSTEM = `Clasificas mensajes de redes sociales (comentarios/DMs) de clientes potenciales de una marca B2C.
Para cada mensaje, devuelve intención de compra, sentimiento y si es spam.

Responde EXCLUSIVAMENTE un array JSON (sin markdown) con un objeto por mensaje EN EL MISMO ORDEN recibido:
[{ "i": <indice>, "score": "high"|"medium"|"low", "sentiment": "positive"|"neutral"|"negative", "spam": true|false }]

Criterios:
- score high: pregunta por precio/talla/stock, "lo quiero", "cómo compro", interés explícito.
- score medium: interés tibio, emojis positivos, preguntas generales.
- score low: comentario casual sin intención.
- spam true: bot, link sospechoso, autopromo, insulto/hate, irrelevante.
Solo el array JSON.`;

const VALID_SCORE: LeadScore[] = ['high', 'medium', 'low'];
const VALID_SENT: LeadSentiment[] = ['positive', 'neutral', 'negative'];

/**
 * Parsea la respuesta del modelo a un array alineado por índice. Defensivo:
 * cualquier ítem ausente o inválido cae a un score neutro no-spam. Puro
 * (testeable sin red).
 */
export function parseScoreResponse(text: string, count: number): ScoredLead[] {
  const fallback = (): ScoredLead => ({
    score: 'low',
    sentiment: 'neutral',
    spam: false,
  });
  const out: ScoredLead[] = Array.from({ length: count }, fallback);

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const i = Number(o.i);
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    out[i] = {
      score: VALID_SCORE.includes(o.score as LeadScore)
        ? (o.score as LeadScore)
        : 'low',
      sentiment: VALID_SENT.includes(o.sentiment as LeadSentiment)
        ? (o.sentiment as LeadSentiment)
        : 'neutral',
      spam: o.spam === true,
    };
  }
  return out;
}

/** Llama al modelo de triage para puntuar una tanda de mensajes. */
export async function scoreLeads(
  apiKey: string,
  texts: string[],
): Promise<ScoredLead[]> {
  if (texts.length === 0) return [];
  const client = getAnthropic(apiKey);
  const userPrompt = texts
    .map((t, i) => `${i}: ${t.slice(0, 400).replace(/\n/g, ' ')}`)
    .join('\n');

  const res = await client.messages.create({
    model: pickModel('lead_score'),
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: SCORE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return parseScoreResponse(text, texts.length);
}

/**
 * Puntúa los destinatarios de una campaña aún sin score: toma el mensaje de
 * origen de cada contacto, lo clasifica en lote y persiste score/sentimiento/
 * spam en el recipient. Service-role.
 */
export async function scoreCampaignRecipients(
  db: SupabaseClient,
  campaignId: string,
  limit = 40,
): Promise<{ scored: number; spam: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { scored: 0, spam: 0 };

  const { data: recipients } = await db
    .from('instagram_campaign_recipients')
    .select('id, contact_id')
    .eq('campaign_id', campaignId)
    .is('lead_score', null)
    .not('contact_id', 'is', null)
    .limit(limit);
  const rows = (recipients ?? []) as Array<{ id: string; contact_id: string }>;
  if (rows.length === 0) return { scored: 0, spam: 0 };

  const texts = await Promise.all(
    rows.map((r) => latestInboundText(db, r.contact_id)),
  );

  let scored: ScoredLead[];
  try {
    scored = await scoreLeads(apiKey, texts.map((t) => t ?? '(sin mensaje)'));
  } catch {
    return { scored: 0, spam: 0 };
  }

  let spamCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = scored[i];
    if (s.spam) spamCount += 1;
    await db
      .from('instagram_campaign_recipients')
      .update({
        lead_score: s.score,
        lead_sentiment: s.sentiment,
        is_spam: s.spam,
        // Spam/hate se descarta del envío inmediatamente.
        ...(s.spam ? { status: 'skipped', error: 'spam/hate' } : {}),
      })
      .eq('id', rows[i].id);
  }

  return { scored: rows.length, spam: spamCount };
}
