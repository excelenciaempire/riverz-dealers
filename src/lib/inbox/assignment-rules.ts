import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resuelve la asignación de una conversación recién creada o sin
 * asignar evaluando las reglas activas del workspace en orden de
 * prioridad. Devuelve el UUID del agente que corresponde o null si
 * ninguna regla matchea (la conv queda en el "sin asignar" como
 * antes).
 *
 * El round_robin mantiene su estado en la fila (`state.last_assigned`)
 * para rotar fair entre los agentes elegidos.
 *
 * Pensado para llamarse desde:
 *   - El webhook de mensaje inbound (cuando se crea una conv nueva).
 *   - Un job de "asignar viejas no asignadas" si el merchant quiere
 *     aplicar las reglas a conversations preexistentes.
 */

interface RuleRow {
  id: string;
  workspace_id: string;
  kind: 'round_robin' | 'by_tag' | 'by_channel' | 'by_keyword';
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  priority: number;
}

export async function resolveAssignmentForConversation(
  admin: SupabaseClient,
  args: {
    workspaceId: string;
    conversationId: string;
    channel: string;
    contactId: string;
    firstMessageText?: string;
  },
): Promise<string | null> {
  const { data: rules } = await admin
    .from('conversation_assignment_rules')
    .select('id, workspace_id, kind, config, state, priority')
    .eq('workspace_id', args.workspaceId)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (!rules || rules.length === 0) return null;

  // Tags del contacto (si alguna regla por tag aplica).
  const tagsByContact = new Set<string>();
  const needsTags = (rules as RuleRow[]).some((r) => r.kind === 'by_tag');
  if (needsTags) {
    const { data: tagRows } = await admin
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', args.contactId);
    for (const r of tagRows ?? []) {
      tagsByContact.add((r as { tag_id: string }).tag_id);
    }
  }

  for (const rule of rules as RuleRow[]) {
    const decision = await evaluateRule(admin, rule, {
      channel: args.channel,
      tagsByContact,
      firstMessageText: args.firstMessageText ?? '',
    });
    if (decision) return decision;
  }
  return null;
}

async function evaluateRule(
  admin: SupabaseClient,
  rule: RuleRow,
  ctx: {
    channel: string;
    tagsByContact: Set<string>;
    firstMessageText: string;
  },
): Promise<string | null> {
  switch (rule.kind) {
    case 'by_channel': {
      const cfg = rule.config as { channel?: string; agent_id?: string };
      if (cfg.channel === ctx.channel && cfg.agent_id) return cfg.agent_id;
      return null;
    }
    case 'by_tag': {
      const cfg = rule.config as { tag_id?: string; agent_id?: string };
      if (cfg.tag_id && ctx.tagsByContact.has(cfg.tag_id) && cfg.agent_id) {
        return cfg.agent_id;
      }
      return null;
    }
    case 'by_keyword': {
      const cfg = rule.config as { keyword?: string; agent_id?: string };
      if (!cfg.keyword || !cfg.agent_id) return null;
      if (ctx.firstMessageText.toLowerCase().includes(cfg.keyword.toLowerCase())) {
        return cfg.agent_id;
      }
      return null;
    }
    case 'round_robin': {
      const cfg = rule.config as { agent_ids?: string[] };
      const agents = cfg.agent_ids ?? [];
      if (agents.length === 0) return null;
      const last = (rule.state as { last_assigned?: string }).last_assigned;
      const idx = last ? agents.indexOf(last) : -1;
      const next = agents[(idx + 1) % agents.length];
      // Persistimos el nuevo "last_assigned". Fire-and-forget no
      // bloquea el inbound — si falla por una race el peor caso es
      // que el siguiente mensaje rote desde el mismo punto.
      void admin
        .from('conversation_assignment_rules')
        .update({ state: { last_assigned: next } })
        .eq('id', rule.id);
      return next;
    }
  }
}
