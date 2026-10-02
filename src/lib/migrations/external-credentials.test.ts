import {describe,expect,it} from 'vitest';
import {sealExternalCredential,openExternalCredential,externalCredentialFingerprint} from './external-credentials';
import type {ExternalSourceDefinition} from './external-source-contract';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const source:ExternalSourceDefinition={provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[42,43]},context={workspaceId:id,actorId:id,jobId:id,source};
describe('External credential context and selected cohort',()=>{
 it('binds actor, tenant, job, provider account and exact selected IDs with authenticated encryption',()=>{
  const sealed=sealExternalCredential(context,'FIXTURE_TOKEN');expect(sealed).not.toContain('FIXTURE_TOKEN');expect(openExternalCredential(context,sealed)).toBe('FIXTURE_TOKEN');
  for(const patch of [{actorId:other},{workspaceId:other},{jobId:other},{source:{...source,accountId:8}},{source:{...source,subscriberIds:[43,42]}},{source:{...source,subscriberIds:[42,44]}}])expect(()=>openExternalCredential({...context,...patch},sealed)).toThrow('source_credential_unavailable');
 });
 it('retains stable retry identity but gives a changed selection a different fingerprint',()=>{
  const a=externalCredentialFingerprint(context,'FIXTURE_TOKEN');expect(externalCredentialFingerprint(context,'FIXTURE_TOKEN')).toBe(a);
  expect(externalCredentialFingerprint({...context,source:{...source,subscriberIds:[43,42]}},'FIXTURE_TOKEN')).not.toBe(a);
  expect(sealExternalCredential(context,'FIXTURE_TOKEN')).not.toBe(sealExternalCredential(context,'FIXTURE_TOKEN'));
 });
 it.each(['plaintext','00:deadbeef','a'.repeat(20001)])('refuses invalid or legacy ciphertext without secret detail',cipher=>expect(()=>openExternalCredential(context,cipher)).toThrow('source_credential_unavailable'));
});
