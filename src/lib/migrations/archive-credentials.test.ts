import {describe,expect,it} from 'vitest';
import {sealArchiveCredential,openArchiveCredential,sealArchiveFileReference,openArchiveFileReference} from './archive-credentials';
import {sealNativeCredential} from './native-credentials';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',source={provider:'chatwoot' as const,origin:'https://source.example.test',accountId:7};
const context={workspaceId:id,actorId:id,jobId:id,receiptId:other,source};
describe('Archive secret purpose and origin binding',()=>{
 it('authenticates every scope field and keeps retries stable across randomized encryption',()=>{
  const first=sealArchiveCredential(context,'FIXTURE_TOKEN'),second=sealArchiveCredential(context,'FIXTURE_TOKEN');expect(first.ciphertext).not.toBe(second.ciphertext);expect(first.fingerprint).toBe(second.fingerprint);expect(openArchiveCredential(context,first.ciphertext)).toBe('FIXTURE_TOKEN');
  for(const patch of [{workspaceId:other},{actorId:other},{jobId:other},{receiptId:id},{source:{...source,accountId:8}}])expect(()=>openArchiveCredential({...context,...patch},first.ciphertext)).toThrow('source_credential_unavailable');
 });
 it('refuses replay between contacts tokens, history tokens and attachment references',()=>{
  const token=sealArchiveCredential(context,'FIXTURE_TOKEN'),contact=sealNativeCredential(context,'FIXTURE_TOKEN'),file=sealArchiveFileReference(context,'1','2','https://files.example.test/file?signature=PRIVATE_SIGNED_TOKEN');
  expect(file).not.toContain('PRIVATE_SIGNED_TOKEN');expect(openArchiveFileReference(context,'1','2',file)).toBe('https://files.example.test/file?signature=PRIVATE_SIGNED_TOKEN');
  expect(()=>openArchiveCredential(context,contact)).toThrow('source_credential_unavailable');expect(()=>openArchiveCredential(context,file)).toThrow('source_credential_unavailable');
  expect(()=>openArchiveFileReference(context,'1','2',token.ciphertext)).toThrow('source_credential_unavailable');
  for(const [message,fileId] of [['3','2'],['1','3']])expect(()=>openArchiveFileReference(context,message,fileId,file)).toThrow('source_credential_unavailable');
 });
 it('does not admit private destinations, oversized links or tampered ciphertext',()=>{
  for(const url of ['http://files.example.test/file','https://127.0.0.1/file','https://user:pass@files.example.test/file','https://files.example.test/'+'x'.repeat(2049)])expect(()=>sealArchiveFileReference(context,'1','2',url)).toThrow();
  const token=sealArchiveCredential(context,'FIXTURE_TOKEN').ciphertext;expect(()=>openArchiveCredential(context,token+'00')).toThrow('source_credential_unavailable');
 });
});
