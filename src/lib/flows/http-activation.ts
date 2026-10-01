import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { userAccess } from '@/lib/mcp/access';
import { workspaceReadOnly } from '@/lib/billing/read-only';
import { httpActionDefinition } from '@/lib/integrations/http-action-contract';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { translate } from '@/lib/i18n/translate';
import { httpFlowActionAllowed, httpFlowConfig, httpFlowConfigMatches } from './http-contract';
import type { ValidationIssue } from './validate';

type Node = { node_key: string; node_type: string; config: Record<string, unknown> };
const uuid = z.string().uuid();
const grantSchema = z.object({ workspace_id: uuid, flow_id: uuid, node_key: z.string(), action_id: uuid,
  action_revision: z.number().int().positive(), node_config: httpFlowConfig, revision: z.number().int().positive(),
  state: z.literal('active'), granted_by: uuid });
const actionSchema = z.object({ id: uuid, workspace_id: uuid, revision: z.number().int().positive(),
  state: z.literal('active'), definition: httpActionDefinition });

export class HttpFlowReviewRequiredError extends Error {
  constructor(locale: 'es' | 'en' = 'es') {
    super(translate(locale, 'flows.httpActiveEditBlocked'));
    this.name = 'HttpFlowReviewRequiredError';
  }
}

/** Configuration preflight only: no contact lookup, credentials, execution or implicit grant.
 * The runtime's transactional checks remain authoritative if anything changes after this read.
 */
export async function httpFlowActivationIssues(db: SupabaseClient, input: {
  workspaceId: string; flowId: string; actorId?: string | null; nodes: readonly Node[]; locale?: 'es' | 'en';
}): Promise<ValidationIssue[]> {
  const nodes = input.nodes.filter(node => node.node_type === 'http_action');
  if (!nodes.length) return [];
  const locale = input.locale ?? 'es';
  const issue = (node: Node, key: string, field = 'action_id'): ValidationIssue => ({
    severity: 'error', scope: 'node', node_key: node.node_key, field, message: translate(locale, key),
  });
  const unavailable = () => nodes.map(node => issue(node, 'flows.httpActivationUnavailable'));
  if (!SHOW_RIVERZ_IMPROVEMENTS || nodes.length > 200 || !uuid.safeParse(input.workspaceId).success
    || !uuid.safeParse(input.flowId).success || !uuid.safeParse(input.actorId).success) return unavailable();
  try {
    const authority = async (actor: string) => {
      const access = await userAccess(db, actor, input.workspaceId);
      return !!access?.admin && (access.sections === null
        || ['/automatizaciones', '/bandeja'].every(section => access.sections!.includes(section)));
    };
    if (!await authority(input.actorId!)) return nodes.map(node => issue(node, 'flows.httpActivationAdmin'));
    if (await workspaceReadOnly(db, input.workspaceId)) return unavailable();
    const configs = nodes.map(node => httpFlowConfig.safeParse(node.config));
    const ids = [...new Set(configs.flatMap(config => config.success ? [config.data.action_id] : []))];
    if (!ids.length) return nodes.map(node => issue(node, 'flows.httpInvalid'));
    const [grants, actions] = await Promise.all([
      db.from('http_action_flow_grants')
        .select('workspace_id, flow_id, node_key, action_id, action_revision, node_config, revision, state, granted_by')
        .eq('workspace_id', input.workspaceId).eq('flow_id', input.flowId).limit(201),
      db.from('http_actions').select('id, workspace_id, revision, state, definition')
        .eq('workspace_id', input.workspaceId).in('id', ids).limit(201),
    ]);
    if (grants.error || actions.error || !Array.isArray(grants.data) || !Array.isArray(actions.data)
      || grants.data.length > 200 || actions.data.length > 200) return unavailable();
    const grantByNode = new Map(grants.data.flatMap(row => {
      const grant = grantSchema.safeParse(row);
      return grant.success && grant.data.workspace_id === input.workspaceId && grant.data.flow_id === input.flowId
        ? [[grant.data.node_key, grant.data] as const] : [];
    }));
    const actionById = new Map(actions.data.flatMap(row => {
      const action = actionSchema.safeParse(row);
      return action.success && action.data.workspace_id === input.workspaceId ? [[action.data.id, action.data] as const] : [];
    }));
    const checked = new Map<string, Promise<boolean>>([[input.actorId!, Promise.resolve(true)]]);
    const issues: ValidationIssue[] = [];
    for (const [index, node] of nodes.entries()) {
      const parsed = configs[index];
      if (!parsed.success) { issues.push(issue(node, 'flows.httpInvalid')); continue; }
      const config = parsed.data, action = actionById.get(config.action_id), grant = grantByNode.get(node.node_key);
      if (!action || action.revision !== config.action_revision || !httpFlowActionAllowed(action.definition)) {
        issues.push(issue(node, 'flows.httpActivationAction')); continue;
      }
      const free = action.definition.parameters.filter(field => !field.source || field.source === 'input');
      if (Object.keys(config.input_vars).some(key => !free.some(field => field.key === key))
        || free.some(field => field.required && !config.input_vars[field.key])) {
        issues.push(issue(node, 'flows.httpActivationInputs', 'input_vars')); continue;
      }
      if (!grant || grant.action_id !== config.action_id || grant.action_revision !== config.action_revision
        || !httpFlowConfigMatches(grant.node_config, config)) {
        issues.push(issue(node, 'flows.httpActivationAuthorization')); continue;
      }
      if (!checked.has(grant.granted_by)) checked.set(grant.granted_by, authority(grant.granted_by));
      if (!await checked.get(grant.granted_by)) issues.push(issue(node, 'flows.httpActivationAuthorization'));
    }
    return issues;
  } catch { return unavailable(); }
}
