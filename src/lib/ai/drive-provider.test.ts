import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadDriveDocument, DRIVE_SCOPE, driveAuthorizationUrl, exchangeDriveCode, parseDriveFile, refreshDriveToken } from './drive-provider';
const id = 'abcdefghijklmnop', now = () => Date.now();
const token = () => ({ access_token: 'access', refresh_token: 'refresh', expires_at: now() + 3_600_000, account_id: 'account', email: 'owner@example.com' });
const meta = { id, name: 'Policy.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', trashed: false,
  version: '12', modifiedTime: '2026-10-01T00:00:00Z', size: '5', capabilities: { canDownload: true } };
const fetcher = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('GOOGLE_DRIVE_CLIENT_ID', 'client'); vi.stubEnv('GOOGLE_DRIVE_CLIENT_SECRET', 'secret'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const response = (value: unknown) => Response.json(value);
function download(before: unknown = meta, after: unknown = meta) {
  fetcher.mockResolvedValueOnce(response(before)).mockResolvedValueOnce(new Response('bytes')).mockResolvedValueOnce(response(after));
  return downloadDriveDocument(token(), id);
}
describe('Drive permissions and bounded document downloads', () => {
  it('accepts selected file identities without fetching pasted URLs', () => {
    expect(parseDriveFile(id)).toBe(id);
    for (const url of [`https://drive.google.com/file/d/${id}/view`, `https://docs.google.com/document/d/${id}/edit`, `https://docs.google.com/spreadsheets/d/${id}/edit`]) expect(parseDriveFile(url)).toBe(id);
    for (const url of ['https://127.0.0.1/file/d/' + id, 'http://drive.google.com/file/d/' + id, 'https://evil.example/?id=' + id, 'https://user@drive.google.com/file/d/' + id, 'https://drive.google.com:4433/file/d/' + id, 'https://drive.google.com/drive/folders/' + id]) expect(parseDriveFile(url)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requests an independent read-only grant with PKCE and offline consent', () => {
    const url = new URL(driveAuthorizationUrl({ state: 'state', challenge: 'challenge', redirectUri: 'https://riverz.co/api/ai/drive/callback' }));
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE + ' openid email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.toString()).not.toContain('secret'); expect(url.toString()).not.toContain('gmail');
  });
  it('checks granted scope and Google account before persisting credentials', async () => {
    fetcher.mockResolvedValueOnce(response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: DRIVE_SCOPE }))
      .mockResolvedValueOnce(response({ sub: 'account', email: 'owner@example.com', email_verified: true }));
    expect(await exchangeDriveCode({ code: 'code', verifier: 'verifier', redirectUri: 'https://riverz.co/callback' })).toMatchObject({ access_token: 'access', refresh_token: 'refresh', account_id: 'account', email: 'owner@example.com' });
    expect(fetcher.mock.calls[0][1].body).toContain('code_verifier=verifier');
  });
  it.each(['scope', 'refresh'])('rejects missing %s rather than silently accepting a Gmail grant', async kind => {
    fetcher.mockResolvedValueOnce(response({ access_token: 'access', ...(kind === 'refresh' ? {} : { refresh_token: 'refresh' }),
      expires_in: 3600, token_type: 'Bearer', scope: kind === 'scope' ? 'gmail' : DRIVE_SCOPE }));
    await expect(exchangeDriveCode({ code: 'code', verifier: 'verifier', redirectUri: 'https://riverz.co/callback' })).rejects.toMatchObject({ code: 'drive_denied' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('preserves refresh identity when Google omits a replacement refresh token', async () => {
    fetcher.mockResolvedValue(response({ access_token: 'fresh', expires_in: 3600, token_type: 'Bearer' }));
    expect(await refreshDriveToken({ ...token(), expires_at: now() - 1 })).toMatchObject({ access_token: 'fresh', refresh_token: 'refresh', account_id: 'account' });
  });
  it('uses a fresh token without any external call', async () => { const current = token(); expect(await refreshDriveToken(current)).toEqual(current); expect(fetcher).not.toHaveBeenCalled(); });
  it('downloads the selected file between two matching permission/version observations', async () => {
    const result = await download(); expect(await result.file.text()).toBe('bytes'); expect(result).toMatchObject({ remoteVersion: '12', modifiedAt: meta.modifiedTime });
    expect(fetcher.mock.calls.every(([url, init]) => String(url).startsWith('https://www.googleapis.com/drive/v3/files/' + id) && init.redirect === 'error' && init.cache === 'no-store')).toBe(true);
  });
  it.each(['version', 'permission', 'trashed', 'identity', 'name'])('rejects changed %s after download', async kind => {
    const after = { ...meta, ...(kind === 'version' ? { version: '13' } : kind === 'permission' ? { capabilities: { canDownload: false } }
      : kind === 'trashed' ? { trashed: true } : kind === 'identity' ? { id: 'another_file_id' } : { name: 'Other.docx' }) };
    await expect(download(meta, after)).rejects.toMatchObject({ code: 'drive_changed' });
  });
  it.each(['permission', 'folder', 'size', 'name'])('blocks %s before content access', async kind => {
    fetcher.mockResolvedValueOnce(response({ ...meta, ...(kind === 'permission' ? { capabilities: { canDownload: false } }
      : kind === 'folder' ? { mimeType: 'application/vnd.google-apps.folder' } : kind === 'size' ? { size: '5242881' } : { name: '../Policy.docx' }) }));
    await expect(downloadDriveDocument(token(), id)).rejects.toMatchObject({ code: kind === 'permission' ? 'drive_denied' : kind === 'size' ? 'document_too_large' : 'drive_unsupported' }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('exports a Google document to the same local Word parser', async () => {
    const native = { ...meta, name: 'Policy', mimeType: 'application/vnd.google-apps.document' };
    const result = await download(native, native); expect(result.file.name).toBe('Policy.docx'); expect(fetcher.mock.calls[1][0]).toContain('/export?mimeType=');
  });
  it('bounds streamed content even if no content length is declared', async () => {
    fetcher.mockResolvedValueOnce(response(meta)).mockResolvedValueOnce(new Response(new Uint8Array(5 * 1024 * 1024 + 1)));
    await expect(downloadDriveDocument(token(), id)).rejects.toMatchObject({ code: 'document_too_large' }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 404, 429, 500])('returns a private code for provider HTTP %s', async status => {
    fetcher.mockResolvedValueOnce(new Response('secret provider response', { status }));
    await expect(downloadDriveDocument(token(), id)).rejects.toMatchObject({ code: status < 429 ? 'drive_denied' : 'drive_unavailable' });
  });
});
