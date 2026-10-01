import { z } from 'zod';
import { decrypt, encrypt } from '@/lib/channels/encryption';
import { httpActionSecret, type HttpActionDefinition } from './http-action-contract';

const envelope = z.object({ workspace_id: z.string().uuid(), action_id: z.string().uuid(),
  origin: z.string().url(), kind: z.enum(['bearer', 'api-key']), header: z.enum(['x-api-key', 'x-make-apikey']).optional(), secret: httpActionSecret }).strict()
  .refine(value => value.header === undefined || value.kind === 'api-key')
  .refine(value => value.header !== 'x-make-apikey' || value.secret.length <= 512);
/** Binding inside authenticated ciphertext prevents copied credentials crossing actions or origins. */
export function sealHttpCredential(workspaceId: string, actionId: string, definition: HttpActionDefinition, secret: string) {
  const bound = envelope.parse({ workspace_id: workspaceId, action_id: actionId,
    origin: new URL(definition.url).origin, kind: definition.credential_kind, secret,
    ...(definition.api_key_header ? { header: definition.api_key_header } : {}) });
  return encrypt(JSON.stringify(bound));
}
export function openHttpCredential(workspaceId: string, actionId: string, definition: HttpActionDefinition, ciphertext: string) {
  try {
    // New HTTP credentials only use authenticated GCM; never accept legacy CBC.
    if (!/^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/.test(ciphertext) || ciphertext.length > 20000) throw new Error('invalid');
    const bound = envelope.parse(JSON.parse(decrypt(ciphertext)));
    if (bound.workspace_id !== workspaceId || bound.action_id !== actionId
      || bound.origin !== new URL(definition.url).origin || bound.kind !== definition.credential_kind
      || (bound.header ?? 'x-api-key') !== (definition.api_key_header ?? 'x-api-key')) throw new Error('invalid');
    return { kind: bound.kind, value: bound.secret, ...(bound.header ? { header: bound.header } : {}) };
  } catch { throw new Error('http_action_credential_unavailable'); }
}
