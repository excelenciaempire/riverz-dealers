/**
 * Flow templates registry.
 *
 * Deliberately empty — flows are the manual-control alternative to the
 * AI assistant. Every store has its own button copy, sub-routes, and
 * branching that don't translate to a one-size template the way an AI
 * agent does. Users build their flow from scratch on the canvas; the
 * editor's inline "+ Añadir" pill at every unconnected branch is the
 * right entry point.
 *
 * The clone-from-template API path (POST /api/flows with template_slug)
 * still works — it just rejects unknown slugs with a 400, which is the
 * right behavior since there are no slugs to clone right now.
 */

import type {
  AiIntentNodeConfig,
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendCtaUrlNodeConfig,
  SendDocumentNodeConfig,
  SendImageNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  SendVideoNodeConfig,
  SetTagNodeConfig,
  ShopifyLookupNodeConfig,
  StartNodeConfig,
  WaitNodeConfig,
} from './types';

export type FlowTemplateNodeType =
  | 'start'
  | 'send_message'
  | 'send_buttons'
  | 'send_list'
  | 'send_image'
  | 'send_video'
  | 'send_document'
  | 'send_cta_url'
  | 'collect_input'
  | 'condition'
  | 'set_tag'
  | 'handoff'
  | 'wait'
  | 'ai_intent'
  | 'shopify_lookup'
  | 'end';

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | SendImageNodeConfig
    | SendVideoNodeConfig
    | SendDocumentNodeConfig
    | SendCtaUrlNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | SetTagNodeConfig
    | HandoffNodeConfig
    | WaitNodeConfig
    | AiIntentNodeConfig
    | ShopifyLookupNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  icon:
    | 'MessageSquare'
    | 'HelpCircle'
    | 'UserPlus'
    | 'Package'
    | 'ShoppingBag'
    | 'Truck';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

const TEMPLATES: Record<string, FlowTemplate> = {};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
