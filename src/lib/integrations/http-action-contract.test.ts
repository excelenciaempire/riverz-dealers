import { describe, expect, it } from 'vitest';
import { actionArguments, actionOutput, actionRequest, actionToolSchema, httpActionDefinition, httpActionWrite } from './http-action-contract';
const definition = () => httpActionDefinition.parse({ name: 'Lookup delivery', description: 'Fetch delivery status from the configured system',
  method: 'GET', url: 'https://integration.test/query?fixed=1', credential_kind: 'bearer',
  parameters: [{ key: 'order_id', type: 'string', required: true }, { key: 'count', type: 'number', required: false }, { key: 'details', type: 'boolean', required: false }],
  outputs: [{ key: 'status', path: ['delivery', 'status'], type: 'string', required: true }, { key: 'found', path: ['found'], type: 'boolean', required: false }],
});
describe('configured external HTTP action contracts', () => {
  it('encodes values without changing the configured origin, path or fixed query', () => {
    const result = actionRequest(definition(), { order_id: 'A?url=https://127.0.0.1&token=x', count: 2, details: false });
    const url = new URL(result.url); expect(url.origin).toBe('https://integration.test'); expect(url.pathname).toBe('/query');
    expect(url.searchParams.get('fixed')).toBe('1'); expect(url.searchParams.get('order_id')).toBe('A?url=https://127.0.0.1&token=x');
    expect(url.searchParams.get('count')).toBe('2'); expect(url.searchParams.get('details')).toBe('false'); expect('body' in result).toBe(false);
  });
  it('serializes only declared parameters for a POST', () => {
    const config = { ...definition(), method: 'POST' as const };
    expect(actionRequest(config, { order_id: 'A"B' })).toEqual({ url: config.url, method: 'POST', body: '{"order_id":"A\\"B"}' });
  });
  it.each([{ order_id: 'one', workspace_id: 'other' }, { order_id: 'one', url: 'https://other.test' }, {},
    { order_id: 1 }, { order_id: 'one', count: '2' }, { order_id: 'one', count: Infinity }, { order_id: 'one', count: 1e13 },
    { order_id: 'one', details: 'true' }, { order_id: { nested: 'one' } }, { order_id: 'x'.repeat(2001) }])('rejects unexpected or incorrectly typed arguments: %j', input => {
    expect(() => actionArguments(definition(), input)).toThrow();
  });
  it('bounds the composed URL, including encoded argument bytes', () => {
    expect(() => actionRequest(definition(), { order_id: 'é'.repeat(400) })).toThrow('http_arguments_invalid');
  });
  it.each(['http://integration.test', 'https://user:pass@integration.test', 'https://localhost', 'https://[::1]',
    'https://integration.test/?api_key=plaintext', 'https://integration.test/?access_token=plaintext', 'https://integration.test/#fragment'])('rejects an unsafe or credential-bearing destination: %s', url => {
    expect(httpActionDefinition.safeParse({ ...definition(), url }).success).toBe(false);
  });
  it('does not allow a dynamic GET parameter to overwrite a fixed destination parameter', () => {
    const config = definition(); config.parameters.push({ key: 'fixed', type: 'string', required: false });
    expect(httpActionDefinition.safeParse(config).success).toBe(false);
  });
  it.each(['constructor', 'prototype', '__proto__', 'Authorization', 'api_key', 'access_token'])('rejects reserved or secret-related field %s', key => {
    const config = definition(); config.parameters[0].key = key; expect(httpActionDefinition.safeParse(config).success).toBe(false);
    const response = definition(); response.outputs[0].path = [key]; expect(httpActionDefinition.safeParse(response).success).toBe(false);
  });
  it('rejects case-insensitive duplicate fields and excessive field lists', () => {
    const config = definition(); config.parameters.push({ key: 'ORDER_ID', type: 'string', required: false });
    expect(httpActionDefinition.safeParse(config).success).toBe(false);
    const huge = definition(); huge.outputs = Array.from({ length: 13 }, (_, i) => ({ key: `value${i}`, type: 'string', required: false, path: ['value'] }));
    expect(httpActionDefinition.safeParse(huge).success).toBe(false);
  });
  it('projects only the declared response fields without returning a raw body', () => {
    expect(actionOutput(definition(), { delivery: { status: 'Dispatched', internal_secret: 'PRIVATE' }, found: true, raw: 'PRIVATE' }))
      .toEqual({ status: 'Dispatched', found: true });
  });
  it.each([null, { delivery: null }, { delivery: { status: 12 } }, { delivery: { status: 'x'.repeat(4001) } },
    { delivery: { status: ['Dispatched'] } }, { delivery: { status: 'Dispatched' }, found: 'true' }])('does not claim a validated result for malformed data: %j', data => {
    expect(() => actionOutput(definition(), data)).toThrow();
  });
  it('does not read inherited properties or array paths', () => {
    expect(() => actionOutput(definition(), Object.create({ delivery: { status: 'forged' } }))).toThrow();
    expect(() => actionOutput(definition(), { delivery: [{ status: 'forged' }] })).toThrow();
  });
  it('rejects a credential echoed in a selected response field', () => {
    expect(() => actionOutput(definition(), { delivery: { status: 'prefix fixture-secret suffix' } }, 'fixture-secret')).toThrow('http_output_invalid');
  });
  it('rejects echoed credentials containing quotes, backslashes or percent-encoded punctuation', () => {
    for (const secret of ['fixture"secret', 'fixture\\secret', 'fixture"secret/path']) {
      expect(() => actionOutput(definition(), { delivery: { status: secret } }, secret)).toThrow('http_output_invalid');
      expect(() => actionOutput(definition(), { delivery: { status: encodeURIComponent(secret) } }, secret)).toThrow('http_output_invalid');
    }
  });
  it('provides model metadata without destination or authentication details and classifies POST as irreversible', () => {
    const schema = actionToolSchema(definition());
    expect(schema.risk).toBe('lectura'); expect(schema.input.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).not.toMatch(/integration\.test|credential|bearer/);
    expect(actionToolSchema({ ...definition(), method: 'POST' }).risk).toBe('irreversible');
  });
  it('validates writes as a strict versioned contract without exposing a credential in the definition', () => {
    expect(httpActionWrite.safeParse({ definition: definition(), expected_version: 0, secret: 'fixture-secret' }).success).toBe(true);
    expect(httpActionWrite.safeParse({ definition: definition(), expected_version: -1 }).success).toBe(false);
    expect(httpActionWrite.safeParse({ definition: { ...definition(), secret: 'plaintext' }, expected_version: 0 }).success).toBe(false);
    expect(httpActionWrite.safeParse({ definition: definition(), expected_version: 0, secret: 'key\r\nHost: private' }).success).toBe(false);
  });
  it('binds server-owned identity fields without allowing the model to override them', () => {
    const config = httpActionDefinition.parse({ ...definition(), parameters: [
      { key: 'order_id', type: 'string', required: true }, { key: 'customer', type: 'string', source: 'contact_id', required: true },
      { key: 'customer_email', type: 'string', source: 'email', required: false },
    ] });
    expect(actionArguments(config, { order_id: 'A' }, { contact_id: 'trusted-customer', email: null })).toEqual({ order_id: 'A', customer: 'trusted-customer' });
    expect(() => actionArguments(config, { order_id: 'A', customer: 'forged' }, { contact_id: 'trusted-customer' })).toThrow();
    expect(() => actionArguments(config, { order_id: 'A' })).toThrow();
    expect(actionToolSchema(config).input.properties).toEqual({ order_id: { type: 'string', maxLength: 2000 } });
  });
  it('rejects non-string identity bindings and normalizes destination URLs before registration', () => {
    expect(httpActionDefinition.safeParse({ ...definition(), parameters: [{ key: 'customer', type: 'number', source: 'contact_id', required: true }] }).success).toBe(false);
    expect(httpActionDefinition.parse({ ...definition(), url: 'HTTPS://INTEGRATION.TEST:443/path' }).url).toBe('https://integration.test/path');
  });
});
