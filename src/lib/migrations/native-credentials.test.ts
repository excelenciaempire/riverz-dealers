import {describe,expect,it} from 'vitest';
import {sealNativeCredential,openNativeCredential,nativeCredentialFingerprint} from './native-credentials';
import {nativeSourceStart,nativeSourceLabel} from './native-source-contract';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const source={provider:'chatwoot' as const,origin:'https://source.example.test',accountId:7};
const context={workspaceId:id,actorId:id,jobId:id,source};
describe('Private migration credential boundary',()=>{
 it('keeps retries stable while binding the secret and context to a keyed fingerprint',()=>{
  const first=nativeCredentialFingerprint(context,'FIXTURE_TOKEN');expect(first).toMatch(/^[a-f0-9]{64}$/);expect(nativeCredentialFingerprint(context,'FIXTURE_TOKEN')).toBe(first);
  expect(sealNativeCredential(context,'FIXTURE_TOKEN')).not.toBe(sealNativeCredential(context,'FIXTURE_TOKEN'));
  for(const patch of [{workspaceId:other},{actorId:other},{jobId:other},{source:{...source,accountId:8}}])expect(nativeCredentialFingerprint({...context,...patch},'FIXTURE_TOKEN')).not.toBe(first);
  expect(nativeCredentialFingerprint(context,'OTHER')).not.toBe(first);
 });
 it('authenticates the actor, workspace, job, origin and account without plaintext storage',()=>{
  const secret=sealNativeCredential(context,'FIXTURE_TOKEN');expect(secret).not.toContain('FIXTURE_TOKEN');expect(openNativeCredential(context,secret)).toBe('FIXTURE_TOKEN');
  for(const patch of [{workspaceId:other},{actorId:other},{jobId:other},{source:{...source,origin:'https://foreign.example.test'}},{source:{...source,accountId:8}}])expect(()=>openNativeCredential({...context,...patch},secret)).toThrow('source_credential_unavailable');
 });
 it('refuses tampering, legacy encryption and malformed ciphertext without crypto details',()=>{
  const secret=sealNativeCredential(context,'FIXTURE_TOKEN'),parts=secret.split(':');parts[1]='0'.repeat(parts[1].length);
  for(const value of [parts.join(':'),'00:deadbeef','PLAINTEXT',secret+'00'])expect(()=>openNativeCredential(context,value)).toThrow('source_credential_unavailable');
 });
 it('canonicalizes only public HTTPS origins and does not accept actor scope in source configuration',()=>{
  const value=nativeSourceStart.parse({id,...source,origin:'https://SOURCE.example.test:443/',token:'FIXTURE_TOKEN'});expect(value.origin).toBe(source.origin);expect(nativeSourceLabel(source)).toBe('https://source.example.test#7');
  for(const patch of [{workspace_id:id},{actor_id:id},{origin:'https://127.0.0.1'},{origin:'https://source.example.test/private'},{origin:'http://source.example.test'},
    {origin:'https://user:pass@source.example.test'},{origin:'https://source.example.test?secret=x'},{origin:'https://source.example.test#x'},{token:'x\r\nCookie: y'}])expect(nativeSourceStart.safeParse({id,...source,token:'FIXTURE_TOKEN',...patch}).success).toBe(false);
 });
});
