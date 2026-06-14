import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/inbox/search?q=...
 *
 * Búsqueda full-text en conversaciones y mensajes históricos. Usa
 * los índices trigram (gin_trgm_ops) creados en migration 029. Devuelve
 * hasta 30 resultados ordenados por relevancia bruta (matches en el
 * preview pesan más que matches en mensajes profundos).
 *
 * Forma del resultado:
 *   { conversations: [{ id, contact_name, snippet, last_message_at,
 *                       match_in: 'preview' | 'message', message_id? }] }
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ conversations: [] });
  }
  const limit = Math.min(30, Number(url.searchParams.get('limit') ?? '30'));

  // RLS scopea ambos selects al workspace del usuario. Primero
  // matches en last_message_text de conversations (más reciente,
  // visible en la lista). Después, matches en messages.content_text.
  const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const [{ data: convs }, { data: msgs }] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, last_message_text, last_message_at, contact_id, contacts(name, phone, email)')
      .ilike('last_message_text', pattern)
      .order('last_message_at', { ascending: false })
      .limit(limit),
    supabase
      .from('messages')
      .select('id, conversation_id, content_text, created_at, conversations(id, contact_id, last_message_at, contacts(name, phone, email))')
      .ilike('content_text', pattern)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  type ContactJoin = { name?: string; phone?: string; email?: string };

  interface ConvRow {
    id: string;
    last_message_text: string | null;
    last_message_at: string | null;
    contact_id: string | null;
    contacts: ContactJoin | ContactJoin[] | null;
  }

  interface MsgRow {
    id: string;
    conversation_id: string | null;
    content_text: string | null;
    created_at: string | null;
    conversations:
      | {
          id: string;
          contact_id: string | null;
          last_message_at: string | null;
          contacts: ContactJoin | ContactJoin[] | null;
        }
      | Array<{
          id: string;
          contact_id: string | null;
          last_message_at: string | null;
          contacts: ContactJoin | ContactJoin[] | null;
        }>
      | null;
  }

  function pickContact(c: ContactJoin | ContactJoin[] | null | undefined): string {
    if (!c) return 'Contacto';
    const ct = Array.isArray(c) ? c[0] : c;
    return (ct?.name || ct?.phone || ct?.email || 'Contacto') as string;
  }

  const seen = new Set<string>();
  const out: Array<{
    id: string;
    contact_name: string;
    snippet: string;
    last_message_at: string | null;
    match_in: 'preview' | 'message';
    message_id?: string;
  }> = [];

  for (const c of (convs ?? []) as ConvRow[]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      contact_name: pickContact(c.contacts),
      snippet: truncate(c.last_message_text ?? '', 120, q),
      last_message_at: c.last_message_at,
      match_in: 'preview',
    });
  }

  for (const m of (msgs ?? []) as MsgRow[]) {
    const convRaw = m.conversations;
    const conv = Array.isArray(convRaw) ? convRaw[0] : convRaw;
    if (!conv) continue;
    if (seen.has(conv.id)) continue;
    seen.add(conv.id);
    out.push({
      id: conv.id,
      contact_name: pickContact(conv.contacts),
      snippet: truncate(m.content_text ?? '', 120, q),
      last_message_at: conv.last_message_at,
      match_in: 'message',
      message_id: m.id,
    });
  }

  return NextResponse.json({ conversations: out.slice(0, limit) });
}

function truncate(s: string, maxLen: number, highlight: string): string {
  const text = s.trim();
  if (text.length <= maxLen) return text;
  // Centra el snippet alrededor del primer match del query si existe.
  const idx = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (idx === -1) return `${text.slice(0, maxLen - 1)}…`;
  const half = Math.floor((maxLen - highlight.length) / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, start + maxLen);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
