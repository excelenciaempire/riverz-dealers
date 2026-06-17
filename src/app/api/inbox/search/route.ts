import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serverError } from '@/lib/api/errors';

/**
 * GET /api/inbox/search?q=...
 *
 * Búsqueda full-text en conversaciones y mensajes históricos. Usa el
 * RPC `inbox_search` (migration 056) que aplica `unaccent` en ambos
 * lados de la comparación — necesario para que "cancion" matchee con
 * "canción" y "anibal" con "Aníbal". El RPC corre como SECURITY
 * INVOKER así que RLS sigue escopeando los resultados al workspace.
 *
 * Forma del resultado:
 *   { conversations: [{ id, contact_name, snippet, last_message_at,
 *                       match_in: 'preview' | 'message', message_id? }] }
 */

interface RpcRow {
  kind: string;
  conversation_id: string;
  message_id: string | null;
  last_message_text: string | null;
  content_text: string | null;
  last_message_at: string | null;
  contact_id: string | null;
}

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

  const { data: rows, error } = await supabase.rpc('inbox_search', {
    q,
    max_rows: limit,
  });
  if (error) {
    return serverError(error);
  }

  // Resolve contact display names in a single round-trip — the RPC
  // returns a contact_id (for 'conv' rows) and conversation_id (for
  // 'msg' rows). Pull contacts via conversations->contacts join.
  const conversationIds = [
    ...new Set(
      (rows as RpcRow[] | null ?? []).map((r) => r.conversation_id).filter(Boolean),
    ),
  ];
  const contactByConv = new Map<string, { name: string }>();
  if (conversationIds.length > 0) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, contact:contacts(name, phone, email)')
      .in('id', conversationIds);
    type Row = {
      id: string;
      contact:
        | { name?: string; phone?: string; email?: string }
        | Array<{ name?: string; phone?: string; email?: string }>
        | null;
    };
    for (const c of (convs ?? []) as Row[]) {
      const ct = Array.isArray(c.contact) ? c.contact[0] : c.contact;
      const name = ct?.name || ct?.phone || ct?.email || 'Contacto';
      contactByConv.set(c.id, { name });
    }
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

  for (const r of (rows as RpcRow[] | null ?? [])) {
    if (seen.has(r.conversation_id)) continue;
    seen.add(r.conversation_id);
    const name = contactByConv.get(r.conversation_id)?.name ?? 'Contacto';
    if (r.kind === 'conv') {
      out.push({
        id: r.conversation_id,
        contact_name: name,
        snippet: truncate(r.last_message_text ?? '', 120, q),
        last_message_at: r.last_message_at,
        match_in: 'preview',
      });
    } else {
      out.push({
        id: r.conversation_id,
        contact_name: name,
        snippet: truncate(r.content_text ?? '', 120, q),
        last_message_at: r.last_message_at,
        match_in: 'message',
        message_id: r.message_id ?? undefined,
      });
    }
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
