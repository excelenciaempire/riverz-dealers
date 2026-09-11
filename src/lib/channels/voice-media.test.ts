import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMedia } from './types';

vi.mock('./encryption', () => ({ decrypt: () => 'token' }));
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('./meta-auth', () => ({ handleMetaGraphError: vi.fn(), clearMetaConnectionError: vi.fn(), isMetaAuthWarning: () => false }));
vi.mock('./meta-graph', () => ({ withAppsecretProofBody: (body: unknown) => body }));
vi.mock('./media-url', () => ({ resolveMediaFetchUrl: async () => 'https://signed.example/audio.mp3' }));
vi.mock('./media-ingest', () => ({ fetchAttachmentBytes: async () => ({ buffer: Buffer.from('MP3 data'), mime: 'audio/mpeg' }), attachmentFilename: () => 'audio.mp3' }));
vi.mock('@/lib/i18n/server', () => ({ safeLocale: async () => 'es' }));
vi.mock('./gmail/watch', () => ({ getFreshAccessToken: async () => 'token' }));
vi.mock('./outlook/watch', () => ({ getFreshAccessToken: async () => 'token', fetchOutlookMessage: vi.fn(), fetchOutlookAttachments: vi.fn() }));
vi.mock('./zoho/auth', () => ({ getFreshZohoAccessToken: async () => 'token', mailApiUrl: () => 'https://mail.zoho.eu' }));
vi.mock('./firma-de-correo', () => ({ conFirma: (text: string) => text }));
import { sendMetaMedia } from './meta-send-media';
import { gmailAdapter } from './gmail/adapter';
import { outlookAdapter } from './outlook/adapter';
import { zohoAdapter } from './zoho/adapter';
import { webchatAdapter } from './webchat/adapter';

const input = { channel: 'instagram', connection: { id: 'connection', config: { email: 'sender@example.com', zoho_account_id: '123' }, secrets: { access_token: 'encrypted' } },
  conversation: { id: 'conversation', subject: 'Order' }, contact: { external_id: 'customer', email: 'customer@example.com' },
  mediaUrl: '/api/media/workspace/voice-notes/test.mp3', mediaType: 'audio', filename: 'audio.mp3', allowHumanAgent: false,
  replyToExternalId: 'original',
} as unknown as OutboundMedia;
let requests: Array<{ url: string; init?: RequestInit }>;
beforeEach(() => { requests = []; });
afterEach(() => vi.unstubAllGlobals());
function respond(fn: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { requests.push({ url: String(url), init }); return fn(String(url), init); }));
}
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

describe('voice delivery protocols', () => {
  it.each(['instagram', 'messenger'] as const)('sends signed audio to %s without exposing private media URLs', async channel => {
    respond(() => json({ message_id: 'mid.audio' }));
    expect(await sendMetaMedia(channel, 'sender', { ...input, channel })).toMatchObject({ externalMessageId: 'mid.audio' });
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ messaging_type: 'RESPONSE', message: {
      attachment: { type: 'audio', payload: { url: 'https://signed.example/audio.mp3' } },
    } });
  });
  it('never retries automated audio with HUMAN_AGENT when Meta closes the window', async () => {
    respond(() => new Response(JSON.stringify({ error: { code: 10, error_subcode: 2018278, message: 'Outside window' } }), { status: 400 }));
    await expect(sendMetaMedia('messenger', 'sender', input)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it('attaches MP3 bytes inside a Gmail MIME message', async () => {
    respond(() => json({ id: 'gmail.audio' }));
    await gmailAdapter.sendMedia!({ ...input, channel: 'gmail' });
    const raw = JSON.parse(String(requests[0].init?.body)).raw;
    const mime = Buffer.from(raw, 'base64url').toString();
    expect(mime).toContain('audio/mpeg');
    expect(mime).toContain('audio.mp3');
    expect(mime).toContain(Buffer.from('MP3 data').toString('base64'));
  });
  it('uploads the Outlook attachment before sending the draft', async () => {
    respond(url => url.endsWith('/send') ? new Response(null, { status: 202 }) : json({ id: 'draft', internetMessageId: '<audio@example.com>' }));
    await outlookAdapter.sendMedia!({ ...input, channel: 'outlook' });
    const attachment = requests.findIndex(r => r.url.endsWith('/attachments'));
    const send = requests.findIndex(r => r.url.endsWith('/send'));
    expect(attachment).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(attachment);
    expect(JSON.parse(String(requests[attachment].init?.body))).toMatchObject({ contentType: 'audio/mpeg', name: 'audio.mp3', contentBytes: Buffer.from('MP3 data').toString('base64') });
  });
  it('uploads audio in the Zoho region and attaches its returned metadata to the email', async () => {
    respond(url => url.includes('/attachments?') ? json({ data: { storeName: 'store', attachmentName: 'audio.mp3', attachmentPath: '/Mail/audio' } }) : json({ data: { messageId: 'zoho.audio' } }));
    expect(await zohoAdapter.sendMedia!({ ...input, channel: 'zoho' })).toMatchObject({ externalMessageId: 'zoho.audio' });
    expect(requests[0].url).toContain('https://mail.zoho.eu/api/accounts/123/messages/attachments');
    expect(requests[1].url).toBe('https://mail.zoho.eu/api/accounts/123/messages');
    expect(JSON.parse(String(requests[1].init?.body))).toMatchObject({ attachments: [{ storeName: 'store', attachmentName: 'audio.mp3', attachmentPath: '/Mail/audio' }] });
  });
  it('does not send a Zoho email when attachment upload fails', async () => {
    respond(() => json({ status: { code: 400 }, data: {} }));
    await expect(zohoAdapter.sendMedia!({ ...input, channel: 'zoho' })).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it('uses the stored-message delivery path for web chat', async () => {
    expect(await webchatAdapter.sendMedia!({ ...input, channel: 'webchat' })).toMatchObject({ status: 'delivered' });
    expect(requests).toHaveLength(0);
  });
});
