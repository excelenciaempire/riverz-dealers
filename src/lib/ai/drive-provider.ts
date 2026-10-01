import 'server-only';
import { z } from 'zod';
import { DOCUMENT_MAX_BYTES } from './document-contract';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILE_URL = 'https://www.googleapis.com/drive/v3/files/';
export class DriveProviderError extends Error {
  constructor(readonly code: 'drive_denied' | 'drive_unavailable' | 'drive_changed' | 'drive_unsupported' | 'document_too_large') { super(code); }
}
export const driveFileId = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/);
export function parseDriveFile(value: string): string | null {
  if (driveFileId.safeParse(value).success) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const match = url.hostname === 'drive.google.com' ? /^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname)
      : url.hostname === 'docs.google.com' ? /^\/(?:document|spreadsheets)\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname) : null;
    return match && driveFileId.safeParse(match[1]).success ? match[1] : null;
  } catch { return null; }
}
export const driveToken = z.object({ access_token: z.string().min(1).max(8192), refresh_token: z.string().min(1).max(8192),
  expires_at: z.number().int().positive(), account_id: z.string().min(1).max(255), email: z.string().email().max(255) }).strict();
export type DriveToken = z.infer<typeof driveToken>;

function client() {
  const id = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new DriveProviderError('drive_unavailable');
  return { id, secret };
}
export function driveAuthorizationUrl(args: { state: string; challenge: string; redirectUri: string }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: client().id, response_type: 'code', redirect_uri: args.redirectUri,
    scope: `${DRIVE_SCOPE} openid email`, state: args.state, code_challenge: args.challenge, code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' }).toString();
  return url.toString();
}
async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { await response.body?.cancel(); throw new DriveProviderError('document_too_large'); }
  const reader = response.body?.getReader();
  if (!reader) throw new DriveProviderError('drive_unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DriveProviderError('document_too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks));
}
async function request(url: string, init: RequestInit = {}) {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DriveProviderError([401, 403, 404].includes(response.status) ? 'drive_denied' : 'drive_unavailable');
    }
    return response;
  } catch (error) { throw error instanceof DriveProviderError ? error : new DriveProviderError('drive_unavailable'); }
}
async function json(url: string, init?: RequestInit): Promise<unknown> {
  try { return JSON.parse(new TextDecoder().decode(await bounded(await request(url, init), 32_000))); }
  catch (error) { throw error instanceof DriveProviderError ? error : new DriveProviderError('drive_unavailable'); }
}
const tokenResponse = z.object({ access_token: z.string().min(1).max(8192), refresh_token: z.string().min(1).max(8192).optional(),
  expires_in: z.number().int().min(1).max(86_400), token_type: z.literal('Bearer'), scope: z.string().max(8192).optional() });
async function exchange(body: Record<string, string>) {
  const cfg = client();
  const result = tokenResponse.safeParse(await json(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, ...body }).toString() }));
  if (!result.success) throw new DriveProviderError('drive_unavailable');
  return result.data;
}
export async function exchangeDriveCode(args: { code: string; verifier: string; redirectUri: string }): Promise<DriveToken> {
  const token = await exchange({ grant_type: 'authorization_code', code: args.code, code_verifier: args.verifier, redirect_uri: args.redirectUri });
  if (!token.refresh_token || !token.scope?.split(' ').includes(DRIVE_SCOPE)) throw new DriveProviderError('drive_denied');
  const account = z.object({ sub: z.string().min(1).max(255), email: z.string().email().max(255), email_verified: z.literal(true) })
    .safeParse(await json('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }));
  if (!account.success) throw new DriveProviderError('drive_denied');
  return driveToken.parse({ access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Date.now() + token.expires_in * 1000,
    account_id: account.data.sub, email: account.data.email });
}
export async function refreshDriveToken(value: DriveToken): Promise<DriveToken> {
  const current = driveToken.parse(value);
  if (current.expires_at > Date.now() + 60_000) return current;
  const fresh = await exchange({ grant_type: 'refresh_token', refresh_token: current.refresh_token });
  if (fresh.scope && !fresh.scope.split(' ').includes(DRIVE_SCOPE)) throw new DriveProviderError('drive_denied');
  return { ...current, access_token: fresh.access_token, refresh_token: fresh.refresh_token ?? current.refresh_token, expires_at: Date.now() + fresh.expires_in * 1000 };
}
const mime = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
const metadata = z.object({ id: driveFileId, name: z.string().min(1).max(160), mimeType: z.string().max(255), trashed: z.boolean(),
  version: z.string().regex(/^\d+$/), modifiedTime: z.string().datetime({ offset: true }),
  size: z.string().regex(/^\d+$/).optional(), capabilities: z.object({ canDownload: z.boolean() }) });
/** Fixed provider URLs only. No folders, shortcuts, recursive collection or remote exportLinks. */
export async function downloadDriveDocument(token: DriveToken, fileId: string): Promise<{ file: File; remoteVersion: string; modifiedAt: string }> {
  const id = driveFileId.parse(fileId), access = driveToken.parse(token);
  const headers = { Authorization: `Bearer ${access.access_token}` };
  const metaUrl = `${FILE_URL}${encodeURIComponent(id)}?${new URLSearchParams({ fields: 'id,name,mimeType,trashed,version,modifiedTime,size,capabilities(canDownload)', supportsAllDrives: 'true' })}`;
  const before = metadata.safeParse(await json(metaUrl, { headers }));
  if (!before.success || before.data.id !== id) throw new DriveProviderError('drive_unavailable');
  const info = before.data;
  if (info.trashed || !info.capabilities.canDownload) throw new DriveProviderError('drive_denied');
  if (info.size && BigInt(info.size) > BigInt(DOCUMENT_MAX_BYTES)) throw new DriveProviderError('document_too_large');
  let format = Object.entries(mime).find(([, type]) => type === info.mimeType)?.[0] as keyof typeof mime | undefined;
  const native = info.mimeType === 'application/vnd.google-apps.document' ? 'docx'
    : info.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'xlsx' : undefined;
  format ??= native;
  if (!format || /[\x00-\x1f\\/]/.test(info.name)) throw new DriveProviderError('drive_unsupported');
  const url = native ? `${FILE_URL}${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType: mime[format] })}`
    : `${FILE_URL}${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
  const bytes = await bounded(await request(url, { headers }), DOCUMENT_MAX_BYTES);
  const after = metadata.safeParse(await json(metaUrl, { headers }));
  if (!after.success || after.data.id !== id || after.data.trashed || !after.data.capabilities.canDownload
    || after.data.version !== info.version || after.data.modifiedTime !== info.modifiedTime || after.data.mimeType !== info.mimeType || after.data.name !== info.name) throw new DriveProviderError('drive_changed');
  let name = info.name;
  if (native) name = name.slice(0, 154) + '.' + format;
  else if (!name.toLowerCase().endsWith('.' + format)) throw new DriveProviderError('drive_unsupported');
  return { file: new File([new Uint8Array(bytes).buffer], name, { type: mime[format] }), remoteVersion: info.version, modifiedAt: info.modifiedTime };
}
