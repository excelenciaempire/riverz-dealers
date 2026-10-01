import { z } from 'zod';
import type { HttpActionDefinition } from '@/lib/integrations/http-action-contract';

const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/)
  .refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
export const httpFlowConfig = z.object({
  action_id: z.string().uuid(), action_revision: z.number().int().positive(),
  input_vars: z.record(key, key).refine(value => Object.keys(value).length <= 12),
  output_prefix: key, next_node_key: z.string().min(1).max(120),
  _notes: z.string().max(2000).optional(),
}).strict();
export type HttpFlowConfig = z.infer<typeof httpFlowConfig>;
export function httpFlowConfigMatches(left: HttpFlowConfig, right: HttpFlowConfig) {
  const ordered = (config: HttpFlowConfig) => ({ ...config,
    input_vars: Object.fromEntries(Object.entries(config.input_vars).sort(([a],[b]) => a.localeCompare(b))),
  });
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

/** POST grants only permit preparing an individually reviewed, conversation-scoped operation. */
export function httpFlowActionAllowed(definition: HttpActionDefinition) {
  return (definition.method === 'GET' || (definition.method === 'POST'
    && definition.parameters.some(field => field.required && field.type === 'string' && field.source === 'conversation_id')))
    && definition.parameters.some(field => field.required && field.type === 'string' && field.source === 'contact_id')
    && !definition.parameters.some(field => field.source === 'phone' || field.source === 'email');
}
export function httpFlowInputs(config: HttpFlowConfig, definition: HttpActionDefinition, vars: Record<string, unknown>) {
  if (!httpFlowActionAllowed(definition)) throw new Error('http_flow_action_forbidden');
  const free = definition.parameters.filter(field => !field.source || field.source === 'input');
  if (Object.keys(config.input_vars).some(name => !free.some(field => field.key === name))) throw new Error('http_flow_input_invalid');
  const input: Record<string, unknown> = {};
  for (const field of free) {
    const variable = config.input_vars[field.key];
    if (!variable || !Object.hasOwn(vars, variable)) {
      if (field.required) throw new Error('http_flow_input_invalid');
      continue;
    }
    input[field.key] = vars[variable];
  }
  return input;
}
export function httpFlowOutput(config: HttpFlowConfig, definition: HttpActionDefinition,
  vars: Record<string, unknown>, result: Record<string, string | number | boolean>) {
  const next = { ...vars };
  // Missing optional fields must not retain an old lookup's value.
  for (const field of definition.outputs) delete next[`${config.output_prefix}_${field.key}`];
  for (const [name, value] of Object.entries(result)) {
    if (!definition.outputs.some(field => field.key === name)) throw new Error('http_flow_output_invalid');
    next[`${config.output_prefix}_${name}`] = value;
  }
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 131072) throw new Error('http_flow_output_invalid');
  return next;
}
