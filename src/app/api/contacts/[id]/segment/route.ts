import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  generateContactSegment,
  isSegmentFresh,
  type ContactSegment,
} from '@/lib/contacts/segment';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { cobrar } from '@/lib/wallet/saldo';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import { costForModel } from '@/lib/admin/cost';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/contacts/[id]/segment[?refresh=1]
 *
 * Returns the contact's AI segment (label + traits) plus their most recent
 * inbound message ("recent activity"). Computes + caches it lazily the first
 * time, reuses the cache for ~14 days, and recomputes on ?refresh=1. RLS
 * scopes every read/write to the caller's workspace.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errInbox.notAuthenticated') },
      { status: 401 },
    );

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, name, ai_segment, ai_summary')
    .eq('id', id)
    .maybeSingle();
  if (!contact)
    return NextResponse.json(
      { error: translate(locale, 'errInbox.notFound') },
      { status: 404 },
    );

  const c = contact as {
    id: string;
    name: string | null;
    ai_segment: ContactSegment | null;
    ai_summary: string | null;
  };

  // Latest inbound message (recent activity) + a window of history for the
  // segment. One round-trip: pull the contact's conversations, then messages.
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', id)
    // Soft-delete (migración 085): exclude threads deleted from the bandeja so
    // their preserved messages don't feed the AI segment or the recent-activity
    // preview in the contact sidebar.
    .is('deleted_at', null);
  const convIds = (convs ?? []).map((x: { id: string }) => x.id);

  let messages: string[] = [];
  let recentActivity: string | null = null;
  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('content_text')
      .in('conversation_id', convIds)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(20);
    messages = (msgs ?? [])
      .map((m: { content_text: string | null }) => m.content_text ?? '')
      .filter(Boolean);
    recentActivity = messages[0] ?? null;
  }

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';

  // Hard min-freshness: even a forced refresh won't recompute if we just did
  // (within 60s). Stops ?refresh=1 from being looped into repeated LLM calls.
  const computedAt = c.ai_segment?.computed_at
    ? new Date(c.ai_segment.computed_at).getTime()
    : 0;
  const justComputed = computedAt > 0 && Date.now() - computedAt < 60_000;

  // Serve the cache unless stale or forced.
  if ((!forceRefresh && isSegmentFresh(c.ai_segment)) || (forceRefresh && justComputed)) {
    return NextResponse.json({ segment: c.ai_segment, recent_activity: recentActivity });
  }

  // La clave sale del mismo lugar que el resto de la IA —la del comercio si la
  // cargó, si no la de la plataforma— en vez de ir directo al entorno. Iba
  // directo, y eso era gasto de Riverz que ninguna cuenta veía ni pagaba.
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  const cache = { segment: c.ai_segment ?? null, recent_activity: recentActivity };
  if (!workspaceId) return NextResponse.json(cache);

  // Sin saldo se sirve lo que haya en caché: es una etiqueta de apoyo, no algo
  // por lo que valga la pena frenar la pantalla.
  if (!(await puedeUsarIa(admin, workspaceId))) return NextResponse.json(cache);

  const resolved = await resolveAnthropicKey(admin, { workspaceId });
  if (!resolved) return NextResponse.json(cache);

  const generated = await generateContactSegment(resolved.key, {
    name: c.name,
    messages,
    purchaseSummary: c.ai_summary,
  });
  if (generated?.uso && resolved.source !== 'agent') {
    void cobrar(admin, workspaceId, {
      concepto: 'ia_clasificacion',
      cantidad: 1,
      costoUsd: costForModel(
        generated.uso.modelo,
        generated.uso.entrada,
        generated.uso.salida,
        { read: generated.uso.cacheLectura, write: generated.uso.cacheEscritura },
      ),
      referenciaTipo: 'contact',
      referenciaId: id,
    });
  }
  if (!generated) {
    return NextResponse.json({ segment: c.ai_segment ?? null, recent_activity: recentActivity });
  }

  const segment: ContactSegment = {
    label: generated.label,
    traits: generated.traits,
    computed_at: new Date().toISOString(),
  };
  await supabase.from('contacts').update({ ai_segment: segment }).eq('id', id);

  return NextResponse.json({ segment, recent_activity: recentActivity });
}
