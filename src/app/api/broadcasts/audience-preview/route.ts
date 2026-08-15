import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { escapeLike } from '@/lib/security/like';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * POST /api/broadcasts/audience-preview
 *
 * Devuelve hasta `limit` contactos representativos del segmento
 * configurado en el wizard de campaña. Sirve para que el merchant vea
 * los nombres concretos antes de mandar 5000 mensajes.
 *
 * Body:
 *   {
 *     audience: {
 *       type: 'all' | 'tags' | 'custom_field' | 'csv',
 *       tagIds?: string[],
 *       customField?: { fieldId, operator: 'is'|'is_not'|'contains', value },
 *       csvContacts?: { phone, name? }[],
 *       excludeTagIds?: string[],
 *     },
 *     limit?: number (max 50)
 *   }
 *
 * Aunque RLS gatea contactos/tags/custom values por membresía de
 * workspace, un usuario miembro de varios workspaces vería el cruce
 * de todos en el preview sin un filtro explícito por workspace_id.
 * Resolvemos el workspace primario del caller y lo agregamos a cada
 * query.
 */

interface AudienceBody {
  audience: {
    type: 'all' | 'tags' | 'custom_field' | 'csv';
    tagIds?: string[];
    customField?: {
      fieldId: string;
      operator: 'is' | 'is_not' | 'contains';
      value: string;
    };
    csvContacts?: Array<{ phone: string; name?: string }>;
    excludeTagIds?: string[];
  };
  limit?: number;
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as AudienceBody | null;
  if (!body?.audience) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.audienceMissing') },
      { status: 400 },
    );
  }
  const limit = Math.max(1, Math.min(50, body.limit ?? 12));
  const a = body.audience;

  // CSV: el preview son los primeros N del CSV. No están en la DB.
  if (a.type === 'csv') {
    return NextResponse.json({
      contacts: (a.csvContacts ?? []).slice(0, limit).map((c, i) => ({
        id: `csv-${i}`,
        name: c.name ?? null,
        phone: c.phone,
        is_shopify_customer: false,
        tags: [] as string[],
      })),
    });
  }

  const admin = supabaseAdmin();
  const member = {
      // Descarta los workspaces borrados. Sin eso, una cuenta que se
      // unió primero a uno que después borró escribe siempre ahí: la
      // fila se guarda y no aparece en ninguna pantalla.
      workspace_id: await resolveWorkspaceIdForUser(admin, user.id),
    };
  const workspaceId =
    (member as { workspace_id?: string } | null)?.workspace_id ?? null;
  if (!workspaceId) {
    return NextResponse.json({ contacts: [] });
  }

  // Resolver los contact_ids del segmento. contact_tags y
  // contact_custom_values no tienen workspace_id propio; el filtro
  // por workspace se aplica al join contra contacts (abajo).
  let candidateIds: string[] | null = null;

  if (a.type === 'tags' && a.tagIds && a.tagIds.length > 0) {
    const { data } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', a.tagIds)
      .limit(500);
    candidateIds = Array.from(
      new Set(
        (data ?? []).map((r: { contact_id: string }) => r.contact_id),
      ),
    );
  } else if (
    a.type === 'custom_field' &&
    a.customField?.fieldId &&
    a.customField.value
  ) {
    let q = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', a.customField.fieldId)
      .limit(500);
    if (a.customField.operator === 'is') q = q.eq('value', a.customField.value);
    else if (a.customField.operator === 'is_not')
      q = q.neq('value', a.customField.value);
    else q = q.ilike('value', `%${escapeLike(a.customField.value)}%`);
    const { data } = await q;
    candidateIds = Array.from(
      new Set(
        (data ?? []).map((r: { contact_id: string }) => r.contact_id),
      ),
    );
  }

  // Excludes — sacamos del set.
  if (a.excludeTagIds && a.excludeTagIds.length > 0) {
    const { data: ex } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', a.excludeTagIds);
    const exSet = new Set(
      (ex ?? []).map((r: { contact_id: string }) => r.contact_id),
    );
    if (candidateIds) {
      candidateIds = candidateIds.filter((id) => !exSet.has(id));
    } else {
      // type === 'all' con exclude: pedimos N+exSet.size por las dudas
      // y filtramos. Simple porque preview es chico.
      const { data: rows } = await supabase
        .from('contacts')
        .select('id, name, phone, is_shopify_customer')
        .eq('workspace_id', workspaceId)
        .eq('opted_out', false)
        .order('updated_at', { ascending: false })
        .limit(limit + exSet.size);
      const filtered = (rows ?? [])
        .filter((r: { id: string }) => !exSet.has(r.id))
        .slice(0, limit);
      return NextResponse.json({
        contacts: await enrichWithTags(supabase, filtered),
      });
    }
  }

  if (!candidateIds && a.type === 'all') {
    const { data: rows } = await supabase
      .from('contacts')
      .select('id, name, phone, is_shopify_customer')
      .eq('workspace_id', workspaceId)
      .eq('opted_out', false)
      .order('updated_at', { ascending: false })
      .limit(limit);
    return NextResponse.json({
      contacts: await enrichWithTags(supabase, rows ?? []),
    });
  }

  if (!candidateIds || candidateIds.length === 0) {
    return NextResponse.json({ contacts: [] });
  }

  // Sacamos los primeros N de los candidatos resueltos, scopeando
  // por workspace_id para no filtrar contactos que el caller pueda
  // ver en otro workspace si está en varios. opted_out=false matches
  // the cron's pre-send filter so the preview reflects reality.
  const subset = candidateIds.slice(0, limit);
  const { data: rows } = await supabase
    .from('contacts')
    .select('id, name, phone, is_shopify_customer')
    .eq('workspace_id', workspaceId)
    .eq('opted_out', false)
    .in('id', subset);

  return NextResponse.json({
    contacts: await enrichWithTags(supabase, rows ?? []),
  });
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface ContactRow {
  id: string;
  name: string | null;
  phone: string | null;
  is_shopify_customer: boolean | null;
}

async function enrichWithTags(
  supabase: SupabaseClient,
  rows: Array<ContactRow | Record<string, unknown>>,
) {
  const ids = rows
    .map((r) => (r as ContactRow).id)
    .filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const { data: tagRows } = await supabase
    .from('contact_tags')
    .select('contact_id, tags(name)')
    .in('contact_id', ids);
  const tagsByContact = new Map<string, string[]>();
  for (const r of tagRows ?? []) {
    const cId = (r as { contact_id: string }).contact_id;
    const tagJoin = (r as { tags: { name?: string } | { name?: string }[] | null }).tags;
    const name = Array.isArray(tagJoin) ? tagJoin[0]?.name : tagJoin?.name;
    if (!name) continue;
    const arr = tagsByContact.get(cId) ?? [];
    arr.push(name);
    tagsByContact.set(cId, arr);
  }
  return (rows as ContactRow[]).map((r) => ({
    id: r.id,
    name: r.name ?? null,
    phone: r.phone ?? null,
    is_shopify_customer: r.is_shopify_customer ?? false,
    tags: tagsByContact.get(r.id) ?? [],
  }));
}
