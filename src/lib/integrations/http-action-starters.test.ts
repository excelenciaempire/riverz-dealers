import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionArguments, actionOutput, actionRequest, actionToolSchema, httpActionDefinition, httpActionWrite } from './http-action-contract';
const h = vi.hoisted(() => ({ visible: true }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
import { HTTP_ACTION_STARTERS, httpActionStarterDocs, httpActionStarterDraft, httpActionStarters } from './http-action-starters';
beforeEach(() => { h.visible = true; });
describe('editable external-system starter templates', () => {
  it('offers only the two native custom-system drafts in the proposed UI', () => {
    expect(httpActionStarters()).toEqual(['custom-lookup','custom-request']);
    const request = httpActionStarterDraft('custom-request','es')!;
    expect(request).toMatchObject({method:'POST',credential_kind:'api-key'});
    expect(request.parameters).toContainEqual({key:'conversation_id',source:'conversation_id',type:'string',required:true});
    expect(httpActionStarterDocs('custom-request')).toBeNull();
  });
  it('offers no templates or draft application outside comparison', () => {
    h.visible = false; expect(httpActionStarters()).toEqual([]); expect(httpActionStarterDraft('n8n-request', 'es')).toBeNull();
  });
  it.each(['es', 'en'] as const)('creates independent incomplete drafts requiring URL and secret in %s', locale => {
    for (const id of HTTP_ACTION_STARTERS) {
      const one = httpActionStarterDraft(id, locale)!;
      expect(one.url).toBe(''); expect(httpActionWrite.safeParse({ definition: one, expected_version: 0, secret: 'fixture-key' }).success).toBe(false);
      const complete = { ...one, url: 'https://fixture.test/production' };
      expect(httpActionWrite.safeParse({ definition: complete, expected_version: 0, secret: 'fixture-key' }).success).toBe(true);
      expect(one).not.toHaveProperty('secret'); expect(one).not.toHaveProperty('action_id'); expect(one).not.toHaveProperty('state');
      one.parameters.length = 0; expect(httpActionStarterDraft(id, locale)!.parameters.length).toBeGreaterThan(0);
    }
  });
  it.each(HTTP_ACTION_STARTERS)('binds contact identity and only exposes free fields in %s', id => {
    const config = httpActionDefinition.parse({ ...httpActionStarterDraft(id, 'en'), url: 'https://fixture.test/production' });
    const name = config.method === 'POST' ? 'request' : 'reference';
    expect(actionToolSchema(config).input.properties).toEqual({ [name]: { type: 'string', maxLength: 2000 } });
    expect(() => actionArguments(config, { [name]: 'fixture' })).toThrow();
    expect(() => actionArguments(config, { [name]: 'fixture', contact_id: 'spoof' }, { contact_id: 'actual', conversation_id: 'actual-conv' })).toThrow();
    const request = actionRequest(config, { [name]: 'fixture' }, { contact_id: 'actual', conversation_id: 'actual-conv' });
    if (config.method === 'POST') expect(JSON.parse(request.body!)).toMatchObject({ contact_id: 'actual', conversation_id: 'actual-conv', request: 'fixture' });
    else expect(new URL(request.url).searchParams.get('contact_id')).toBe('actual');
    expect(actionOutput(config, { status: 'received', private_data: 'NEVER_EXPOSE' })).toEqual({ status: 'received' });
    expect(() => actionOutput(config, { accepted: true })).toThrow();
    expect(() => actionOutput(config, 'Accepted')).toThrow();
  });
  it('uses protected Make authentication and retains standard headers for n8n/custom endpoints', () => {
    expect(httpActionStarterDraft('make-request', 'es')).toMatchObject({ method: 'POST', credential_kind: 'api-key', api_key_header: 'x-make-apikey' });
    expect(httpActionStarterDraft('n8n-request', 'en')).not.toHaveProperty('api_key_header');
    expect(httpActionStarterDocs('make-request')).toBe('https://apps.make.com/gateway'); expect(httpActionStarterDocs('custom-lookup')).toBeNull();
    expect(httpActionStarterDraft('unknown', 'en')).toBeNull();
  });
  it('restricts header configuration to API keys, a fixed allowlist and the Make size bound', () => {
    const def = { ...httpActionStarterDraft('make-request', 'en')!, url: 'https://fixture.test/production' };
    expect(httpActionWrite.safeParse({ definition: def, expected_version: 0, secret: 'x'.repeat(512) }).success).toBe(true);
    expect(httpActionWrite.safeParse({ definition: def, expected_version: 0, secret: 'x'.repeat(513) }).success).toBe(false);
    for (const api_key_header of ['authorization', 'cookie', 'host', 'X-API-Key']) expect(httpActionDefinition.safeParse({ ...def, api_key_header }).success).toBe(false);
    for (const credential_kind of ['none', 'bearer']) expect(httpActionDefinition.safeParse({ ...def, credential_kind }).success).toBe(false);
  });
});
