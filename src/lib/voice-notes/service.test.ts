import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/types';

const mocks = vi.hoisted(() => ({
  db: { from: vi.fn(), storage: { from: vi.fn() } },
  gate: vi.fn(),
  send: vi.fn(),
  tts: vi.fn(),
  connection: vi.fn(),
}));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => mocks.db,
}));
vi.mock('@/lib/channels/registry', () => ({
  getAdapter: () => ({ sendMedia: mocks.send }),
}));
vi.mock('@/lib/channels/send-guard', () => ({
  assertStoredConnectionCanSend: mocks.connection,
}));
vi.mock('@/lib/outreach/send-gate', () => ({ checkSendGate: mocks.gate }));
vi.mock('@/lib/voice/model-config', () => ({
  getVoiceModelResolved: async () => ({
    tts_provider: 'fish',
    tts_model: 's2.1-pro',
    tts_api_key: 'test',
    tts_default_voice_id: 'a'.repeat(32),
  }),
}));
vi.mock('@/lib/voice/compat', () => ({
  normalizeStack: (config: unknown) => ({ config }),
}));
vi.mock('@/lib/voice/tts-billing', () => ({ synthesizeBilled: mocks.tts }));
vi.mock('@/lib/wallet/puerta', () => ({ exigirSaldo: async () => null }));
vi.mock('@/lib/workspaces/motor', () => ({ motorApagado: async () => false }));
vi.mock('./audio', () => ({ toVoiceAudio: async (buffer: Buffer) => buffer }));
vi.mock('music-metadata', () => ({
  parseBuffer: async () => ({
    format: {
      container: 'Ogg',
      codec: 'Opus',
      numberOfChannels: 1,
      duration: 1,
    },
  }),
}));

import { ownedVoicePath, prepareVoiceNote, sendVoiceNote } from './service';

let lastInbound: string;
let contactWorkspace: string;
let activeChannel: Channel;
const queries: {
  table: string;
  filters: Record<string, unknown>;
  inserted?: Record<string, unknown>;
}[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  lastInbound = new Date().toISOString();
  contactWorkspace = 'workspace';
  activeChannel = 'whatsapp';
  mocks.gate.mockResolvedValue({ allow: true });
  mocks.send.mockResolvedValue({
    externalMessageId: 'wamid.voice',
    status: 'sent',
  });
  mocks.tts.mockImplementation(
    async () => new Response(new Uint8Array([1, 2, 3]))
  );
  mocks.db.storage.from.mockReturnValue({
    upload: async () => ({ error: null }),
    download: async () => ({ data: new Blob(['audio']), error: null }),
  });
  mocks.db.from.mockImplementation((table) => {
    const q: (typeof queries)[number] = { table, filters: {} };
    queries.push(q);
    const result = () => {
      const data =
        table === 'conversations'
          ? {
              id: 'conversation',
              workspace_id: 'workspace',
              contact_id: 'contact',
              channel: activeChannel,
              connection_id: 'connection',
            }
          : table === 'contacts'
            ? contactWorkspace === q.filters.workspace_id
              ? { id: 'contact', name: 'José', workspace_id: contactWorkspace }
              : null
            : table === 'channel_connections'
              ? {
                  id: 'connection',
                  workspace_id: 'workspace',
                  channel: activeChannel,
                }
              : table === 'messages'
                ? q.inserted
                  ? {
                      ...q.inserted,
                      id: 'message',
                      created_at: new Date().toISOString(),
                    }
                  : { created_at: lastInbound }
                : null;
      return Promise.resolve({ data, error: null });
    };
    const builder = {
      select: () => builder,
      is: () => builder,
      eq: (key: string, value: unknown) => {
        q.filters[key] = value;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (row: Record<string, unknown>) => {
        q.inserted = row;
        return builder;
      },
      update: () => builder,
      maybeSingle: result,
      single: result,
      then: (resolve: (value: unknown) => unknown) => result().then(resolve),
    };
    return builder;
  });
});

const args = {
  workspaceId: 'workspace',
  conversationId: 'conversation',
  config: { text: 'Hola {{name}}' },
};
describe('voice note delivery guards', () => {
  it.each(['instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat'] as Channel[])
    ('delivers MP3 through %s and stores a playable channel-specific record', async channel => {
      activeChannel = channel;
      if (['gmail', 'outlook', 'zoho', 'webchat'].includes(channel)) lastInbound = new Date(0).toISOString();
      const result = await sendVoiceNote(args);
      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ channel, mediaType: 'audio',
        mediaUrl: expect.stringMatching(/\.mp3$/), voiceNote: false, allowHumanAgent: false }));
      expect(result.message).toMatchObject({ channel, media_mime: 'audio/mpeg', content_type: 'audio' });
      expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({ channel }));
    });
  it.each(['instagram', 'messenger'] as Channel[])('blocks expired %s audio before generation', async channel => {
    activeChannel = channel;
    lastInbound = new Date(0).toISOString();
    await expect(sendVoiceNote(args)).rejects.toThrow('voiceNotes.window');
    expect(mocks.tts).not.toHaveBeenCalled();
  });
  it.each(['fb_comment', 'ig_comment', 'tiktok_comment', 'mercadolibre', 'voice'] as Channel[])
    ('rejects unsupported %s before generation or sending', async channel => {
      activeChannel = channel;
      await expect(sendVoiceNote(args)).rejects.toThrow('voiceNotes.unsupportedChannel');
      expect(mocks.tts).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    });
  it('blocks expired windows before paying Fish or sending to Meta', async () => {
    lastInbound = new Date(Date.now() - 86400001).toISOString();
    await expect(sendVoiceNote(args)).rejects.toThrow('voiceNotes.window');
    expect(mocks.tts).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(queries.find((q) => q.table === 'messages')?.filters).toEqual({
      conversation_id: 'conversation',
      sender_type: 'customer',
    });
  });
  it('honors opt-out before generation', async () => {
    mocks.gate.mockResolvedValue({ allow: false, barrier: 'baja' });
    await expect(sendVoiceNote(args)).rejects.toThrow('voiceNotes.blocked');
    expect(mocks.tts).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('will not use a contact belonging to a different workspace', async () => {
    contactWorkspace = 'another-workspace';
    await expect(sendVoiceNote(args)).rejects.toThrow(
      'voiceNotes.conversationMissing'
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rechecks the window after synthesis', async () => {
    mocks.tts.mockImplementation(async () => {
      lastInbound = new Date(Date.now() - 86400001).toISOString();
      return new Response(new Uint8Array([1]));
    });
    await expect(sendVoiceNote(args)).rejects.toThrow('voiceNotes.window');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('stores playable audio, transcript and the provider message id', async () => {
    const result = await sendVoiceNote(args);
    expect(mocks.tts.mock.calls[0][1]).toMatchObject({
      provider: 'fish',
      format: 'opus',
      text: 'Hola José',
    });
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      voiceNote: true,
      mediaType: 'audio',
    });
    expect(result.message).toMatchObject({
      content_type: 'audio',
      media_transcription: 'Hola José',
      message_id: 'wamid.voice',
    });
  });
  it('does not send when Fish fails', async () => {
    mocks.tts.mockRejectedValue(new Error('provider failed'));
    await expect(sendVoiceNote(args)).rejects.toThrow('provider failed');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('cancels an automatic reply when a new customer message arrives during synthesis', async () => {
    lastInbound = new Date(Date.now() - 10000).toISOString();
    mocks.tts.mockImplementation(async () => {
      lastInbound = new Date().toISOString();
      return new Response(new Uint8Array([1]));
    });
    await expect(sendVoiceNote(args)).rejects.toThrow(
      'voiceNotes.contextChanged'
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('scopes template resolution to the workspace', async () => {
    await expect(
      prepareVoiceNote('workspace', { template_id: 'other-template' })
    ).rejects.toThrow('voiceNotes.templateMissing');
    expect(queries[0].filters).toEqual({
      workspace_id: 'workspace',
      id: 'other-template',
    });
  });
  it('rejects foreign, signed external and traversal paths', () => {
    for (const url of [
      '/api/media/other/voice-notes/id.ogg',
      'https://evil.test/api/media/workspace/voice-notes/id.ogg',
      '/api/media/workspace/voice-notes/../../secret.ogg',
      '/api/media/workspace/voice-notes/%2e%2e/secret.ogg',
    ])
      expect(() => ownedVoicePath('workspace', url)).toThrow();
  });
});
