import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {uploadArchiveObject,downloadArchiveObject,removeArchiveObjects} from './archive-storage';
const path='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/99';
const file={path,messageId:'10',fileId:'99',mime:'image/png',bytes:3,sha256:createHash('sha256').update('abc').digest('hex')};
const request=vi.fn();
beforeEach(()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.supabase.co');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','PRIVATE_FIXTURE_KEY');vi.stubGlobal('fetch',request);request.mockReset().mockResolvedValue(new Response('abc'));});
describe('Private archive storage boundary',()=>{
 it('uploads to the fixed private bucket once, without replacing or exposing a signed URL',async()=>{
  await uploadArchiveObject(path,Buffer.from('abc'),'image/png');expect(request).toHaveBeenCalledOnce();const [url,options]=request.mock.calls[0];
  expect(url).toBe(`https://fixture.supabase.co/storage/v1/object/migration-archives/${path}`);expect(options).toMatchObject({method:'POST',redirect:'error',cache:'no-store',headers:{'x-upsert':'false',authorization:'Bearer PRIVATE_FIXTURE_KEY'}});expect(options.signal).toBeInstanceOf(AbortSignal);
 });
 it('checks byte count and SHA-256 before serving stored data',async()=>{
  expect(await downloadArchiveObject(file)).toEqual({buffer:Buffer.from('abc'),mime:'image/png',fileId:'99'});
  request.mockResolvedValue(new Response('xyz'));await expect(downloadArchiveObject(file)).rejects.toThrow('source_changed');
 });
 it('deletes only validated registered exact paths, never a bucket prefix',async()=>{
  await removeArchiveObjects([path]);expect(request.mock.calls[0][1]).toMatchObject({method:'DELETE',body:JSON.stringify({prefixes:[path]})});
  await expect(removeArchiveObjects(['../customer-media'])).rejects.toThrow('source_invalid');await expect(removeArchiveObjects([])).rejects.toThrow('source_invalid');expect(request).toHaveBeenCalledOnce();
 });
 it('refuses arbitrary paths, forged file metadata and oversized bytes before storage',async()=>{
  await expect(uploadArchiveObject('https://foreign.test/a',Buffer.from('a'),'text/plain')).rejects.toThrow('source_invalid');
  await expect(downloadArchiveObject({...file,url:'https://foreign.test'})).rejects.toThrow('source_invalid');expect(request).not.toHaveBeenCalled();
 });
 it('never forwards credentials to redirects or retries a lost upload response',async()=>{
  request.mockRejectedValue(new Error('PRIVATE_FIXTURE_KEY'));await expect(uploadArchiveObject(path,Buffer.from('a'),'text/plain')).rejects.toThrow(/^source_unavailable$/);expect(request).toHaveBeenCalledOnce();
 });
});
