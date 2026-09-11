import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { limitByKey } from '@/lib/rate-limit';
import {
  ownedVoicePath,
  prepareVoiceNote,
  sendVoiceNote,
  storeVoiceAudio,
} from '@/lib/voice-notes/service';
import {
  MAX_VOICE_NOTE_BYTES,
  validVoiceConfig,
  type VoiceNoteConfig,
} from '@/lib/voice-notes/types';

export const maxDuration = 120;

async function membership(workspaceId: string) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) return false;
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspace_id') ?? '';
  if (!(await membership(workspaceId)))
    return NextResponse.json(
      { error: translate(await getLocale(), 'errInbox.forbidden') },
      { status: 403 }
    );
  const { data, error } = await supabaseAdmin()
    .from('voice_note_templates')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name');
  if (error)
    return NextResponse.json(
      { error: translate(await getLocale(), 'voiceNotes.failed') },
      { status: 500 }
    );
  return NextResponse.json({ templates: data });
}

export async function POST(req: Request) {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  try {
    if (req.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await req.formData();
      const workspaceId = String(form.get('workspace_id') ?? '');
      if (!(await membership(workspaceId)))
        return NextResponse.json(
          { error: translate(locale, 'errInbox.forbidden') },
          { status: 403 }
        );
      const file = form.get('file');
      if (!(file instanceof Blob) || file.size > MAX_VOICE_NOTE_BYTES)
        throw new Error('voiceNotes.invalidAudio');
      return NextResponse.json({
        url: await storeVoiceAudio(
          workspaceId,
          Buffer.from(await file.arrayBuffer())
        ),
      });
    }
    const body = await req.json();
    const workspaceId =
      typeof body.workspace_id === 'string' ? body.workspace_id : '';
    if (!(await membership(workspaceId)))
      return NextResponse.json(
        { error: translate(locale, 'errInbox.forbidden') },
        { status: 403 }
      );
    if (!validVoiceConfig(body.config))
      throw new Error('voiceNotes.invalidText');
    const limit = await limitByKey(`voice-notes:${workspaceId}`, {
      limit: 20,
      windowMs: 60000,
    });
    if (!limit.success)
      return NextResponse.json(
        { error: translate(locale, 'voiceNotes.rateLimit') },
        { status: 429 }
      );
    const config: VoiceNoteConfig = body.config;
    if (body.action === 'save') {
      if (
        config.template_id ||
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 100
      )
        throw new Error('voiceNotes.invalidText');
      if (config.media_url) ownedVoicePath(workspaceId, config.media_url);
      const { data, error } = await supabaseAdmin()
        .from('voice_note_templates')
        .insert({ workspace_id: workspaceId, name: body.name.trim(), config })
        .select('*')
        .single();
      if (error) throw new Error('voiceNotes.failed');
      return NextResponse.json({ template: data });
    }
    if (body.action === 'send') {
      if (typeof body.conversation_id !== 'string')
        throw new Error('voiceNotes.conversationMissing');
      const result = await sendVoiceNote({
        workspaceId,
        conversationId: body.conversation_id,
        config,
        variables: {
          reply: typeof body.text === 'string' ? body.text : undefined,
        },
        sender: 'agent',
        origin: 'manual',
      });
      return NextResponse.json(result);
    }
    if (body.action !== 'preview') throw new Error('voiceNotes.invalidText');
    const variables =
      body.variables &&
      typeof body.variables === 'object' &&
      !Array.isArray(body.variables)
        ? Object.fromEntries(
            Object.entries(body.variables).filter(
              ([, v]) => typeof v === 'string' && v.length <= 2000
            )
          )
        : {};
    return NextResponse.json(
      await prepareVoiceNote(workspaceId, config, variables)
    );
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith('voiceNotes.')
        ? error.message
        : 'voiceNotes.failed';
    return NextResponse.json(
      { error: translate(locale, code) },
      { status: code === 'voiceNotes.window' ? 409 : 400 }
    );
  }
}
