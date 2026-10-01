import { z } from 'zod';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';

const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'authorization', 'password', 'secret',
  'access_token', 'refresh_token', 'api_key', 'service_role_key']);
const key = z.string().min(1).max(48).regex(/^[A-Za-z][A-Za-z0-9_]*$/).refine(value => !forbidden.has(value.toLowerCase()));
const scalarType = z.enum(['string', 'number', 'boolean']);
const binding = z.enum(['input', 'contact_id', 'conversation_id', 'phone', 'email']);
const parameter = z.object({ key, type: scalarType, required: z.boolean(), source: binding.optional() }).strict()
  .refine(value => !value.source || value.source === 'input' || value.type === 'string');
const output = z.object({ key, type: scalarType, path: z.array(key).min(1).max(5), required: z.boolean() }).strict();
const unique = (values: Array<{ key: string }>) => new Set(values.map(value => value.key.toLowerCase())).size === values.length;
const destination = z.string().min(1).max(2048).refine(value => {
  const url = isPublicHttpsUrl(value);
  return !!url && url.href.length <= 2048 && !url.hash
    && [...url.searchParams.keys()].every(name => !/token|secret|password|api.?key|authorization/i.test(name));
}).transform(value => new URL(value).href);

/** Credentials live separately, never inside the model-visible action definition. */
export const httpActionDefinition = z.object({
  name: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(500),
  method: z.enum(['GET', 'POST']), url: destination, credential_kind: z.enum(['none', 'bearer', 'api-key']),
  parameters: z.array(parameter).max(12).refine(unique), outputs: z.array(output).max(12).refine(unique),
}).strict().refine(value => value.method !== 'GET' || value.parameters.every(field => {
  const url = new URL(value.url); return !url.searchParams.has(field.key);
}));
export type HttpActionDefinition = z.infer<typeof httpActionDefinition>;
export const httpActionSecret = z.string().min(8).max(4096).regex(/^[\x20-\x7e]+$/);
export const httpActionWrite = z.object({ definition: httpActionDefinition, secret: httpActionSecret.optional(),
  expected_version: z.number().int().nonnegative() }).strict();

/** Bounded validated definitions and projected scalars only; includes escaped URL echoes. */
export function httpActionContainsSecret(value: unknown, secret: string): boolean {
  if (typeof value === 'string') return value.includes(secret)
    || value.replace(/%[0-9a-f]{2}/gi, escape => String.fromCharCode(parseInt(escape.slice(1), 16))).includes(secret);
  if (Array.isArray(value)) return value.some(item => httpActionContainsSecret(item, secret));
  if (value !== null && typeof value === 'object') return Object.values(value).some(item => httpActionContainsSecret(item, secret));
  return value !== null && value !== undefined && String(value).includes(secret);
}

function scalar(value: unknown, type: 'string' | 'number' | 'boolean', maxLength: number) {
  if (type === 'string') return z.string().max(maxLength).parse(value);
  if (type === 'number') return z.number().finite().min(-1e12).max(1e12).parse(value);
  return z.boolean().parse(value);
}
export type HttpActionBindings = Partial<Record<Exclude<z.infer<typeof binding>, 'input'>, string | null>>;
export function actionArguments(definition: HttpActionDefinition, input: unknown, trusted: HttpActionBindings = {}) {
  const value = z.record(z.string(), z.unknown()).parse(input);
  if (Object.keys(value).some(name => !definition.parameters.some(field => field.key === name && (!field.source || field.source === 'input')))) throw new Error('http_arguments_invalid');
  const result: Record<string, string | number | boolean> = {};
  for (const field of definition.parameters) {
    const bound = field.source && field.source !== 'input';
    const supplied = bound ? trusted[field.source as Exclude<z.infer<typeof binding>, 'input'>] : value[field.key];
    if (bound ? supplied === undefined || supplied === null : !Object.hasOwn(value, field.key)) {
      if (field.required) throw new Error('http_arguments_invalid');
      continue;
    }
    result[field.key] = scalar(supplied, field.type, 2000);
  }
  return result;
}
export function actionRequest(definition: HttpActionDefinition, input: unknown, trusted: HttpActionBindings = {}) {
  const parameters = actionArguments(definition, input, trusted), url = new URL(definition.url);
  if (definition.method === 'GET') for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, String(value));
  if (url.href.length > 2048) throw new Error('http_arguments_invalid');
  return { url: url.href, method: definition.method, ...(definition.method === 'POST' ? { body: JSON.stringify(parameters) } : {}) };
}
export function actionOutput(definition: HttpActionDefinition, data: unknown, secret?: string) {
  const result: Record<string, string | number | boolean> = {};
  for (const field of definition.outputs) {
    let value: unknown = data;
    for (const part of field.path) {
      value = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, part)
        ? (value as Record<string, unknown>)[part] : undefined;
    }
    if (value === undefined || value === null) {
      if (field.required) throw new Error('http_output_invalid');
      continue;
    }
    result[field.key] = scalar(value, field.type, 4000);
  }
  // An upstream credential echo must never become model or flow context.
  if (secret && httpActionContainsSecret(result, secret)) throw new Error('http_output_invalid');
  return result;
}
/** Tool metadata excludes URL, authentication configuration and ciphertext. */
export function actionToolSchema(definition: HttpActionDefinition) {
  const inputs = definition.parameters.filter(field => !field.source || field.source === 'input');
  return { name: definition.name, description: definition.description, risk: definition.method === 'GET' ? 'lectura' : 'irreversible',
    input: { type: 'object', additionalProperties: false,
      properties: Object.fromEntries(inputs.map(field => [field.key, { type: field.type,
        ...(field.type === 'string' ? { maxLength: 2000 } : field.type === 'number' ? { minimum: -1e12, maximum: 1e12 } : {}) }])),
      required: inputs.filter(field => field.required).map(field => field.key) } };
}
