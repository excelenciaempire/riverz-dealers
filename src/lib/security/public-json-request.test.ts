import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ dns: vi.fn(), mode: 'ok', status: 200, content: '{}',
  headers: {} as Record<string, string>, response: null as EventEmitter | null, destroyed: vi.fn(),
  calls: [] as Array<{ url: URL; options: RequestOptions; body?: string }> }));
vi.mock('node:dns/promises', () => ({ lookup: h.dns }));
vi.mock('node:https', () => ({ request: (url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => {
  const call = { url, options, body: undefined as string | undefined }; h.calls.push(call); let closed = false;
  const outgoing = Object.assign(new EventEmitter(), { end: (body?: string) => {
    call.body = body;
    queueMicrotask(() => {
      if (closed) return;
      if (h.mode === 'socket-error') { closed = true; outgoing.emit('error', new Error('SECRET_IN_PRIVATE_ERROR')); return; }
      if (h.mode === 'socket-hang') return;
      const response = Object.assign(new EventEmitter(), { statusCode: h.status,
        headers: { 'content-type': 'application/json', ...h.headers }, destroy: () => { h.destroyed(); closed = true; response.emit('close'); } });
      h.response = response; callback(response as unknown as IncomingMessage);
      if (closed || h.mode === 'body-hang') return;
      if (h.mode === 'body-error') { response.emit('aborted'); return; }
      if (h.mode === 'utf8-error') response.emit('data', Buffer.from([0xc3, 0x28]));
      else if (h.mode === 'chunk-large') { response.emit('data', Buffer.alloc(128 * 1024)); response.emit('data', Buffer.from('x')); }
      else response.emit('data', Buffer.from(h.content));
      if (!closed) { closed = true; response.emit('end'); response.emit('close'); }
    });
  } });
  options.signal?.addEventListener('abort', () => { if (!closed) { closed = true; outgoing.emit('error', new Error('SECRET_ABORT')); h.response?.emit('aborted'); } }, { once: true });
  return outgoing;
} }));
import { requestPublicJson, requestChatwootJson, requestExternalContactJson, PublicJsonError, type PublicJsonRequest } from './public-json-request';
beforeEach(() => {
  h.calls = []; h.response = null; h.mode = 'ok'; h.status = 200; h.content = '{}'; h.headers = {}; h.destroyed.mockReset();
  h.dns.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
});
afterEach(() => vi.useRealTimers());
const input = (patch: Partial<PublicJsonRequest> = {}): PublicJsonRequest => ({ url: 'https://integration.test/query', method: 'GET', ...patch });
const unsafeHeaders: Record<string, string>[] = [{ 'content-type': 'text/html' }, { 'content-encoding': 'gzip' }, { 'content-length': '131073' }];
describe('bounded public JSON transport', () => {
  it.each([
    {provider:'kommo' as const,url:'https://fixture.kommo.com/api/v4/contacts?page=1&limit=25&order%5Bid%5D=asc'},
    {provider:'manychat' as const,url:'https://api.manychat.com/fb/page/getInfo'},
    {provider:'manychat' as const,url:'https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=42'},
  ])('allows fixed external GET resources with a bearer and pinned TLS: $url',async input=>{
    await requestExternalContactJson({...input,token:'FIXTURE_TOKEN'});expect(h.calls).toHaveLength(1);
    expect(h.calls[0].options).toMatchObject({method:'GET',rejectUnauthorized:true,headers:{authorization:'Bearer FIXTURE_TOKEN'}});expect(h.calls[0].body).toBeUndefined();
  });
  it.each([
    {provider:'kommo' as const,url:'https://fixture.kommo.com.evil.test/api/v4/contacts?page=1&limit=25&order%5Bid%5D=asc'},
    {provider:'kommo' as const,url:'https://fixture.kommo.com/api/v4/leads?page=1&limit=25&order%5Bid%5D=asc'},
    {provider:'kommo' as const,url:'https://fixture.kommo.com/api/v4/contacts?page=1&limit=250&order%5Bid%5D=asc'},
    {provider:'kommo' as const,url:'https://fixture.kommo.com/api/v4/contacts?page=1&page=2&limit=25&order%5Bid%5D=asc'},
    {provider:'kommo' as const,url:'https://fixture.kommo.com/api/v4/contacts?page=202&limit=25&order%5Bid%5D=asc'},
    {provider:'manychat' as const,url:'https://api.manychat.com/fb/subscriber/sendContent?subscriber_id=42'},
    {provider:'manychat' as const,url:'https://api.manychat.com/fb/page/getInfo?token=secret'},
    {provider:'manychat' as const,url:'https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=42&subscriber_id=43'},
    {provider:'manychat' as const,url:'https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=9007199254740992'},
  ])('rejects external scope/route/query injection before DNS: $url',async input=>{
    await expect(requestExternalContactJson({...input,token:'FIXTURE_TOKEN'})).rejects.toBeInstanceOf(PublicJsonError);expect(h.dns).not.toHaveBeenCalled();expect(h.calls).toHaveLength(0);
  });
  it('supports a dedicated Chatwoot read with its fixed token header, public DNS and verified TLS',async()=>{
    await requestChatwootJson({url:'https://source.example.test/api/v1/accounts/7/contacts?page=1&include_contact_inboxes=false',token:'FIXTURE_TOKEN'});
    expect(h.calls).toHaveLength(1);expect(h.calls[0].options).toMatchObject({method:'GET',rejectUnauthorized:true,headers:{api_access_token:'FIXTURE_TOKEN'}});
    expect(h.calls[0].options.headers).not.toHaveProperty('authorization');expect(h.calls[0].body).toBeUndefined();expect(h.dns).toHaveBeenCalledOnce();
  });
  it.each(['/api/v1/accounts/7/conversations?status=all&page=1&assignee_type=all','/api/v1/accounts/7/conversations/11','/api/v1/accounts/7/conversations/11/messages?before=42','/api/v1/accounts/7/contacts/8/conversations','/api/v1/accounts/7/contacts/8/conversations?conversation_id=11','/api/v1/accounts/7/contacts/8/conversations?conversation_id=9007199254740991'])('allows only the documented read resource %s',async path=>{
    await requestChatwootJson({url:'https://source.example.test'+path,token:'FIXTURE_TOKEN'});expect(h.calls[0].options.method).toBe('GET');
  });
  it.each(['/api/v1/profile','/api/v1/accounts/7/campaigns','/api/v1/accounts/7/conversations/11/messages?after=0','/api/v1/accounts/7/contacts?page=1&page=2',
    '/api/v1/accounts/7/contacts?sort=bogus','/api/v1/accounts/7/conversations?status=open','/api/v1/accounts/7/contacts?include_contact_inboxes=true','/api/v1/accounts/7/contacts?page=2147483648',
    '/api/v1/accounts/7/contacts/8/conversations?conversation_id=0','/api/v1/accounts/7/contacts/8/conversations?conversation_id=9007199254740992',
    '/api/v1/accounts/7/contacts/8/conversations?conversation_id=11&conversation_id=12','/api/v1/accounts/7/conversations/11/messages?conversation_id=11',
    '/api/v1/accounts/7/contacts/8/conversations?conversation_id=1.5','/api/v1/accounts/7/contacts/8/conversations?conversation_id=-1'])('rejects unscoped or malformed provider reads %s before DNS',async path=>{
    await expect(requestChatwootJson({url:'https://source.example.test'+path,token:'FIXTURE_TOKEN'})).rejects.toBeInstanceOf(Error);expect(h.dns).not.toHaveBeenCalled();expect(h.calls).toHaveLength(0);
  });
  it.each([{method:'POST'},{headers:{cookie:'PRIVATE'}},{token:'x\r\nHost: private'},{token:'x'.repeat(4097)}])('refuses injected writes, headers or invalid provider credentials',async extra=>{
    await expect(requestChatwootJson({url:'https://source.example.test/api/v1/accounts/7/contacts',token:'FIXTURE_TOKEN',...extra} as {url:string;token:string})).rejects.toMatchObject({code:'http_input_invalid'});expect(h.calls).toHaveLength(0);
  });
  it('never follows a provider redirect or exposes its error body and token',async()=>{
    h.status=302;h.headers.location='https://foreign.example.test';h.content='PRIVATE_TOKEN_IN_ERROR';
    const error=await requestChatwootJson({url:'https://source.example.test/api/v1/accounts/7/contacts',token:'FIXTURE_TOKEN'}).catch(error=>error);
    expect(error).toMatchObject({code:'http_status_failed',status:302});expect(error.message).not.toMatch(/PRIVATE|FIXTURE|foreign/);expect(h.calls).toHaveLength(1);
  });
  it('pins DNS, preserves hostname/TLS checks and sends exact UTF-8 JSON once', async () => {
    h.dns.mockResolvedValue([{ address: '2606:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }]);
    h.content = '{"result":"Atención"}'; const body = '{"question":"Atención"}';
    expect(await requestPublicJson(input({ url: 'https://integration.test/query#ignored', method: 'POST', body,
      credential: { kind: 'bearer', value: 'synthetic-key' }, idempotencyKey: 'abcdefghijklmnop' })))
      .toEqual({ status: 200, data: { result: 'Atención' } });
    expect(h.calls).toHaveLength(1); const call = h.calls[0];
    expect(call.url.hostname).toBe('integration.test'); expect(call.url.hash).toBe(''); expect(call.body).toBe(body);
    expect(call.options).toMatchObject({ method: 'POST', agent: false, rejectUnauthorized: true, maxHeaderSize: 16384 });
    expect(call.options.headers).toMatchObject({ authorization: 'Bearer synthetic-key', 'idempotency-key': 'abcdefghijklmnop',
      'content-length': String(Buffer.byteLength(body)), 'accept-encoding': 'identity' });
    const cb = vi.fn(); call.options.lookup!('integration.test', { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700::1111', family: 6 }]);
    expect(h.dns).toHaveBeenCalledOnce();
  });
  it('supports an API key without arbitrary headers', async () => {
    await requestPublicJson(input({ credential: { kind: 'api-key', value: 'fixture-api-key' } }));
    expect(h.calls[0].options.headers).toMatchObject({ 'x-api-key': 'fixture-api-key' });
    expect(h.calls[0].body).toBeUndefined();
  });
  it('sends a Make key through its fixed header with no additional authentication header', async () => {
    await requestPublicJson(input({ credential: { kind: 'api-key', header: 'x-make-apikey', value: 'fixture-make-key' } }));
    expect(h.calls[0].options.headers).toMatchObject({ 'x-make-apikey': 'fixture-make-key' });
    expect(h.calls[0].options.headers).not.toHaveProperty('x-api-key'); expect(h.calls[0].options.headers).not.toHaveProperty('authorization');
    expect(h.calls).toHaveLength(1);
  });
  it.each(['authorization', 'host', 'cookie', 'x-forwarded-for', 'x-custom', 'X-API-Key'])('rejects arbitrary credential header %s before DNS', async header => {
    await expect(requestPublicJson(input({ credential: { kind: 'api-key', header, value: 'fixture-key' } } as Partial<PublicJsonRequest>)))
      .rejects.toMatchObject({ code: 'http_input_invalid', dispatched: false });
    expect(h.dns).not.toHaveBeenCalled(); expect(h.calls).toHaveLength(0);
  });
  it.each([{ kind: 'bearer', header: 'x-make-apikey', value: 'fixture-key' }, { kind: 'api-key', header: 'x-make-apikey', value: 'x'.repeat(513) }])('rejects invalid Make credentials before DNS', async credential => {
    await expect(requestPublicJson(input({ credential } as Partial<PublicJsonRequest>))).rejects.toMatchObject({ code: 'http_input_invalid', dispatched: false });
    expect(h.dns).not.toHaveBeenCalled(); expect(h.calls).toHaveLength(0);
  });
  it.each(['http://integration.test', 'https://user:pass@integration.test', 'https://127.0.0.1', 'https://localhost',
    'https://169.254.169.254', 'https://[::1]', 'https://[::ffff:7f00:1]'])('rejects forbidden literal %s before connecting', async url => {
    await expect(requestPublicJson(input({ url }))).rejects.toMatchObject({ code: 'http_destination_forbidden', dispatched: false });
    expect(h.calls).toHaveLength(0);
  });
  it.each(['10.0.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', 'fd00::1', '2001:db8::1'])('rejects mixed DNS with %s before connecting', async address => {
    h.dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }]);
    await expect(requestPublicJson(input())).rejects.toMatchObject({ code: 'http_destination_forbidden', dispatched: false });
    expect(h.calls).toHaveLength(0);
  });
  it.each([
    { method: 'PUT' }, { body: '{}' }, { method: 'POST', body: 'not-json' }, { method: 'POST', body: 'x'.repeat(65537) },
    { credential: { kind: 'bearer', value: 'key\r\nHost: private' } }, { credential: { kind: 'cookie', value: 'key' } },
    { credential: { kind: 'api-key', value: 'x'.repeat(4097) } }, { idempotencyKey: 'short' },
  ])('rejects malformed inputs before DNS', async patch => {
    await expect(requestPublicJson(input(patch as Partial<PublicJsonRequest>))).rejects.toMatchObject({ code: 'http_input_invalid', dispatched: false });
    expect(h.dns).not.toHaveBeenCalled(); expect(h.calls).toHaveLength(0);
  });
  it('enforces canonical URL length as well as supplied length', async () => {
    await expect(requestPublicJson(input({ url: `https://integration.test/${'é'.repeat(400)}` }))).rejects.toMatchObject({ code: 'http_destination_forbidden' });
    expect(h.dns).not.toHaveBeenCalled();
  });
  it.each([301, 307, 400, 429, 500])('rejects status %s without redirect, body retention or automatic retry', async status => {
    h.status = status; h.headers.location = 'https://127.0.0.1/private'; h.content = 'PRIVATE_BODY';
    await expect(requestPublicJson(input({ method: 'POST', body: '{}' }))).rejects.toMatchObject({ code: 'http_status_failed', status, dispatched: true });
    expect(h.calls).toHaveLength(1); expect(h.destroyed).toHaveBeenCalledOnce();
  });
  it.each([204, 205])('acknowledges empty status %s without pretending to have a JSON result', async status => {
    h.status = status; expect(await requestPublicJson(input())).toEqual({ status, data: null });
    expect(h.destroyed).toHaveBeenCalledOnce();
  });
  it.each(unsafeHeaders)('rejects unsafe response headers %j', async headers => {
    h.headers = headers;
    await expect(requestPublicJson(input())).rejects.toMatchObject({ dispatched: true }); expect(h.destroyed).toHaveBeenCalledOnce();
  });
  it('accepts structured JSON media types', async () => {
    h.headers['content-type'] = 'application/problem+json; charset=utf-8';
    expect(await requestPublicJson(input())).toEqual({ status: 200, data: {} });
  });
  it.each(['chunk-large', 'utf8-error', 'body-error', 'socket-error'])('bounds and sanitizes %s failures without replaying the POST', async mode => {
    h.mode = mode;
    const result = await requestPublicJson(input({ method: 'POST', body: '{}' })).catch(error => error);
    expect(result).toMatchObject({ dispatched: true }); expect(result.message).not.toMatch(/SECRET|integration\.test|PRIVATE/);
    expect(h.calls).toHaveLength(1);
  });
  it('rejects invalid JSON', async () => {
    h.content = '<private-error>'; await expect(requestPublicJson(input())).rejects.toMatchObject({ code: 'http_response_invalid' });
  });
  it.each(['dns', 'socket-hang', 'body-hang'])('limits the complete %s operation to eight seconds', async phase => {
    vi.useFakeTimers(); if (phase === 'dns') h.dns.mockReturnValue(new Promise(() => {})); else h.mode = phase;
    const pending = requestPublicJson(input({ method: 'POST', body: '{}' })).catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ code: 'http_timeout', dispatched: phase !== 'dns' });
    expect(h.calls).toHaveLength(phase === 'dns' ? 0 : 1); expect(vi.getTimerCount()).toBe(0);
  });
});
