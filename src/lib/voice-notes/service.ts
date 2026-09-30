import { resolveHumanAttention } from '@/lib/inbox/human-attention';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { randomUUID } from 'crypto';
import { parseBuffer } from 'music-metadata';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import {
  appMediaUrl,
  MEDIA_BUCKET,
  storagePathFromSegments,
} from '@/lib/channels/media-url';
import { getAdapter } from '@/lib/channels/registry';
import { assertStoredConnectionCanSend } from '@/lib/channels/send-guard';
import { checkSendGate, type SendReason } from '@/lib/outreach/send-gate';
import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { normalizeStack } from '@/lib/voice/compat';
import { synthesizeBilled } from '@/lib/voice/tts-billing';
import { exigirSaldo } from '@/lib/wallet/puerta';
import { toVoiceAudio } from './audio';
import { motorApagado } from '@/lib/workspaces/motor';
import { supportsVoiceNotes, voiceRequiresWindow } from './channels';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import {
  MAX_VOICE_NOTE_BYTES,
  renderVoiceText,
  validVoiceConfig,
  type VoiceNoteConfig,
} from './types';

export function ownedVoicePath(workspaceId: string, url: string): string {
  const prefix = `/api/media/${workspaceId}/voice-notes/`;
  if (!url.startsWith(prefix)) throw new Error('voiceNotes.invalidAudio');
  const path = storagePathFromSegments(
    url.slice('/api/media/'.length).split('/')
  );
  if (!path || !path.endsWith('.ogg'))
    throw new Error('voiceNotes.invalidAudio');
  return path;
}

export async function storeVoiceAudio(
  workspaceId: string,
  buffer: Buffer
): Promise<string> {
  buffer = await toVoiceAudio(buffer);
  if (!buffer.length || buffer.length > MAX_VOICE_NOTE_BYTES)
    throw new Error('voiceNotes.invalidAudio');
  const metadata = await parseBuffer(buffer).catch(() => null);
  if (
    metadata?.format.container !== 'Ogg' ||
    !metadata.format.codec?.toLowerCase().includes('opus') ||
    metadata.format.numberOfChannels !== 1
  ) {
    throw new Error('voiceNotes.invalidAudio');
  }
  const path = `${workspaceId}/voice-notes/${randomUUID()}.ogg`;
  const { error } = await supabaseAdmin()
    .storage.from(MEDIA_BUCKET)
    .upload(path, buffer, { contentType: 'audio/ogg', upsert: false });
  if (error) throw new Error('voiceNotes.failed');
  return appMediaUrl(path);
}

export async function resolveVoiceConfig(
  workspaceId: string,
  config: VoiceNoteConfig
): Promise<VoiceNoteConfig> {
  if (!validVoiceConfig(config)) throw new Error('voiceNotes.invalidText');
  if (!config.template_id) return config;
  const { data, error } = await supabaseAdmin()
    .from('voice_note_templates')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('id', config.template_id)
    .maybeSingle();
  if (
    error ||
    !data ||
    !validVoiceConfig(data.config) ||
    data.config.template_id
  )
    throw new Error('voiceNotes.templateMissing');
  return data.config;
}

export async function prepareVoiceNote(
  workspaceId: string,
  input: VoiceNoteConfig,
  variables: Record<string, unknown> = {}
) {
  const config = await resolveVoiceConfig(workspaceId, input);
  if (config.media_url) {
    const path = ownedVoicePath(workspaceId, config.media_url);
    // A user-supplied URL cannot attest to the format or existence of a file.
    const { data, error } = await supabaseAdmin()
      .storage.from(MEDIA_BUCKET)
      .download(path);
    if (error || !data || data.size > MAX_VOICE_NOTE_BYTES)
      throw new Error('voiceNotes.invalidAudio');
    const metadata = await parseBuffer(
      Buffer.from(await data.arrayBuffer())
    ).catch(() => null);
    if (
      metadata?.format.container !== 'Ogg' ||
      !metadata.format.codec?.toLowerCase().includes('opus') ||
      metadata.format.numberOfChannels !== 1
    )
      throw new Error('voiceNotes.invalidAudio');
    return { url: config.media_url, text: null };
  }
  const text = renderVoiceText(config.text ?? '', variables);
  if (await exigirSaldo(supabaseAdmin(), workspaceId))
    throw new Error('voiceNotes.budget');
  const raw = await getVoiceModelResolved(supabaseAdmin());
  const model = raw ? normalizeStack(raw).config : null;
  const key =
    (model?.tts_provider === 'fish' ? model.tts_api_key : null) ||
    process.env.FISH_API_KEY ||
    process.env.FISH_AUDIO_API_KEY;
  const voice =
    config.voice_id?.trim() ||
    (model?.tts_provider === 'fish' ? model.tts_default_voice_id : null);
  if (!key || !voice) throw new Error('voiceNotes.notConfigured');
  const { data: privateVoice, error: privateVoiceError } = await supabaseAdmin()
    .from('workspace_voice_models')
    .select('workspace_id')
    .eq('provider', 'fish')
    .eq('provider_model_id', voice)
    .maybeSingle();
  if (
    privateVoiceError ||
    (privateVoice && privateVoice.workspace_id !== workspaceId)
  )
    throw new Error('voiceNotes.notConfigured');
  const response = await synthesizeBilled(
    { db: supabaseAdmin(), workspaceId, concepto: 'voz_tts' },
    {
      provider: 'fish',
      key,
      model:
        model?.tts_provider === 'fish'
          ? model.tts_model || 's2.1-pro'
          : 's2.1-pro',
      voice,
      text,
      format: 'opus',
    }
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  return { url: await storeVoiceAudio(workspaceId, buffer), text };
}

export async function sendVoiceNote(args: {
  expectedRecipient?: { contactId: string; phone: string };
  workspaceId: string;
  conversationId: string;
  config: VoiceNoteConfig;
  variables?: Record<string, unknown>;
  sender?: 'agent' | 'bot';
  origin?: string;
  originName?: string | null;
  reason?: SendReason;
  cooldownHours?: number;
  replyToExternalId?: string;
}) {
  const db = supabaseAdmin();
  if (args.sender !== 'agent' && (await motorApagado(db, args.workspaceId)))
    throw new Error('voiceNotes.blocked');
  const { data: conversation } = await db
    .from('conversations')
    .select('*')
    .eq('id', args.conversationId)
    .eq('workspace_id', args.workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!conversation?.connection_id)
    throw new Error('voiceNotes.conversationMissing');
  const channel = conversation.channel as Conversation['channel'];
  if (!supportsVoiceNotes(channel)) throw new Error('voiceNotes.unsupportedChannel');
  const adapter = getAdapter(channel);
  if (!adapter.sendMedia) throw new Error('voiceNotes.unsupportedChannel');
  const { data: contact } = await db
    .from('contacts')
    .select('*')
    .eq('id', conversation.contact_id)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle();
  const { data: connection } = await db
    .from('channel_connections')
    .select('*')
    .eq('id', conversation.connection_id)
    .eq('workspace_id', args.workspaceId)
    .eq('channel', channel)
    .maybeSingle();
  if (!contact || !connection || connection.channel !== channel)
    throw new Error('voiceNotes.conversationMissing');
  if (args.expectedRecipient && (contact.id !== args.expectedRecipient.contactId ||
    sanitizePhoneForMeta(String(contact.phone ?? '')) !== args.expectedRecipient.phone))
    throw new Error('voiceNotes.contextChanged');
  let initialInbound: string | undefined;
  const check = async () => {
    await assertStoredConnectionCanSend(db, connection.id);
    const gate = await checkSendGate({
      db,
      workspaceId: args.workspaceId,
      contactId: contact.id,
      kind: 'text',
      channel,
      reason: args.reason ?? 'asistente',
      cooldownHours: args.cooldownHours,
    });
    if (!gate.allow)
      throw new Error(
        gate.barrier === 'ventana_24h'
          ? 'voiceNotes.window'
          : 'voiceNotes.blocked'
      );
    // Scope to this phone connection, not a recent message on another channel.
    const { data: last, error } = await db
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      error || (voiceRequiresWindow(channel) && (
      !last ||
      Date.now() - Date.parse(last.created_at) >= 86400000 ||
      !Number.isFinite(Date.parse(last.created_at))))
    )
      throw new Error('voiceNotes.window');
    if (
      args.sender !== 'agent' &&
      initialInbound &&
        initialInbound !== last?.created_at
    )
      throw new Error('voiceNotes.contextChanged');
    initialInbound = last?.created_at;
  };
  await check();
  const audio = await prepareVoiceNote(args.workspaceId, args.config, {
    name: contact.name,
    first_name: String(contact.name ?? '').split(' ')[0],
    ...args.variables,
  });
  let mediaUrl = audio.url;
  let mediaMime = 'audio/ogg';
  if (channel !== 'whatsapp') {
    const { data, error } = await db.storage.from(MEDIA_BUCKET).download(ownedVoicePath(args.workspaceId, audio.url));
    if (error || !data) throw new Error('voiceNotes.invalidAudio');
    const mp3 = await toVoiceAudio(Buffer.from(await data.arrayBuffer()), 'mp3');
    const path = `${args.workspaceId}/voice-notes/${randomUUID()}.mp3`;
    const stored = await db.storage.from(MEDIA_BUCKET).upload(path, mp3, { contentType: 'audio/mpeg', upsert: false });
    if (stored.error) throw new Error('voiceNotes.failed');
    mediaUrl = appMediaUrl(path);
    mediaMime = 'audio/mpeg';
  }
  await check();
  const result = await adapter.sendMedia!({
    channel,
    connection: connection as ChannelConnection,
    conversation: conversation as Conversation,
    contact: contact as Contact,
    mediaType: 'audio',
    mediaUrl,
    voiceNote: channel === 'whatsapp',
    filename: channel === 'whatsapp' ? 'audio.ogg' : 'audio.mp3',
    allowHumanAgent: false,
    replyToExternalId: args.replyToExternalId,
  });
  const { data: message, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      channel,
      sender_type: args.sender ?? 'bot',
      content_type: 'audio',
      content_text: audio.text,
      media_url: mediaUrl,
      media_type: 'audio',
      media_mime: mediaMime,
      media_transcription: audio.text,
      message_id: result.externalMessageId,
      status: result.status ?? 'sent',
      origin: args.origin ?? 'automation',
      origin_name: args.originName ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error('voiceNotes.sentNotSaved');
  await resolveHumanAttention(db, message);
  await db
    .from('conversations')
    .update({
      last_message_text: audio.text ?? '[Audio]',
      last_message_at: message.created_at,
      last_sender_type: args.sender ?? 'bot',
      updated_at: message.created_at,
    })
    .eq('id', conversation.id);
  return { message, externalMessageId: result.externalMessageId };
}
