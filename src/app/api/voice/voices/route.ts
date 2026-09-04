import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { createClient } from '@/lib/supabase/server';
import { CURATED_VOICES_BY_PROVIDER } from '@/lib/voice/constants';
import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import {
  isVoiceAdmin,
  isVoiceMember,
} from '@/lib/voice/voice-connection-store';

const FISH_MODEL_URL = 'https://api.fish.audio/model';
const FISH_PROVIDER_PAGE_SIZE = 100;
const FISH_LIBRARY_PAGE_SIZE = 250;
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
const MAX_SAMPLES = 3;
const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/ogg',
  'audio/opus',
]);

type FishModel = {
  _id?: string;
  title?: string;
  type?: 'tts' | 'svc';
  state?: 'created' | 'training' | 'trained' | 'failed';
  languages?: string[];
  tags?: string[];
  samples?: { audio?: string }[];
};

type WorkspaceVoice = {
  provider_model_id: string;
  name: string;
  state: 'created' | 'training' | 'trained' | 'failed';
};

function isFishModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value);
}

async function fishKey() {
  const model = await getVoiceModelResolved(supabaseAdmin());
  if (model.mode !== 'pipeline' || model.tts_provider.toLowerCase() !== 'fish')
    return null;
  return (
    model.tts_api_key ||
    process.env.FISH_API_KEY ||
    process.env.FISH_AUDIO_API_KEY ||
    null
  );
}

function fishGender(tags?: string[]): 'female' | 'male' | 'neutral' {
  const normalized = (tags ?? []).map((tag) => tag.toLowerCase());
  if (normalized.some((tag) => tag === 'female' || tag === 'mujer'))
    return 'female';
  if (normalized.some((tag) => tag === 'male' || tag === 'hombre'))
    return 'male';
  return 'neutral';
}

async function fishLibraryPage(
  apiKey: string | null,
  page: number,
  query: string | undefined,
  tags: string[],
  sortBy: 'score' | 'task_count' | 'created_at'
) {
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : undefined;
  const start = (page - 1) * FISH_LIBRARY_PAGE_SIZE;
  const firstProviderPage = Math.floor(start / FISH_PROVIDER_PAGE_SIZE) + 1;
  const offsetWithinFirstPage = start % FISH_PROVIDER_PAGE_SIZE;
  const providerPagesNeeded = Math.ceil(
    (offsetWithinFirstPage + FISH_LIBRARY_PAGE_SIZE) / FISH_PROVIDER_PAGE_SIZE
  );
  const payloads = await Promise.all(
    Array.from({ length: providerPagesNeeded }, async (_, index) => {
      const url = new URL(FISH_MODEL_URL);
      url.searchParams.set('page_size', String(FISH_PROVIDER_PAGE_SIZE));
      url.searchParams.set('page_number', String(firstProviderPage + index));
      url.searchParams.set('language', 'es');
      url.searchParams.set('sort_by', sortBy);
      if (query) url.searchParams.set('title', query);
      for (const tag of tags) url.searchParams.append('tag', tag);
      const res = await fetch(url, {
        headers,
        next: { revalidate: 300 },
      });
      if (!res.ok) throw new Error(`Fish library ${res.status}`);
      return (await res.json()) as {
        total?: number;
        items?: FishModel[];
        has_more?: boolean | null;
      };
    })
  );
  const items = payloads
    .flatMap((payload) => payload.items ?? [])
    .slice(
      offsetWithinFirstPage,
      offsetWithinFirstPage + FISH_LIBRARY_PAGE_SIZE
    );
  const lastPayload = payloads.at(-1) as {
    total?: number;
    items?: FishModel[];
    has_more?: boolean | null;
  };
  return {
    voices: items
      .filter(
        (item) =>
          isFishModelId(item._id) &&
          item.type !== 'svc' &&
          item.state !== 'failed'
      )
      .map((item) => ({
        voice_id: item._id!,
        label: item.title?.trim() || 'Fish Audio',
        locale: 'es-419' as const,
        gender: fishGender(item.tags),
        source: 'library' as const,
        state: item.state ?? 'trained',
        tags: item.tags ?? [],
        preview_url: item.samples?.find((sample) =>
          sample.audio?.startsWith('https://')
        )?.audio,
      })),
    hasMore: Boolean(lastPayload.has_more),
    total: Number.isFinite(payloads[0]?.total)
      ? Number(payloads[0].total)
      : null,
  };
}

function allowedParam<T extends string>(
  value: string | null,
  allowed: readonly T[]
): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

async function refreshCustomVoiceStates(
  voices: WorkspaceVoice[],
  apiKey: string
) {
  const pending = voices
    .filter((voice) => voice.state === 'created' || voice.state === 'training')
    .slice(0, 10);
  if (!pending.length) return voices;
  const updates = await Promise.all(
    pending.map(async (voice) => {
      try {
        const res = await fetch(
          `${FISH_MODEL_URL}/${voice.provider_model_id}`,
          {
            headers: { authorization: `Bearer ${apiKey}` },
            cache: 'no-store',
          }
        );
        const model = (await res.json().catch(() => null)) as FishModel | null;
        const state = model?.state;
        if (res.ok && state && state !== voice.state) {
          await supabaseAdmin()
            .from('workspace_voice_models')
            .update({ state, updated_at: new Date().toISOString() })
            .eq('provider_model_id', voice.provider_model_id);
          return { ...voice, state };
        }
      } catch (error) {
        console.error('[voice/voices] Fish model status unavailable', error);
      }
      return voice;
    })
  );
  return voices.map(
    (voice) =>
      updates.find(
        (update) => update.provider_model_id === voice.provider_model_id
      ) ?? voice
  );
}

/**
 * Las voces entre las que el comercio puede elegir DE VERDAD.
 *
 * El proveedor de TTS lo fija la plataforma en `/admin/voz` y el comercio no lo
 * ve. El editor, mientras tanto, ofrecía siempre las cuatro voces de
 * ElevenLabs: se guardaban, `resolveVoiceId` las descartaba por no tener la
 * forma del proveedor activo, y la llamada salía con la voz por defecto. Las
 * cuatro sonaban igual porque el botón de escuchar sintetiza con el proveedor
 * real.
 *
 * Devuelve las del proveedor activo, o una lista vacía cuando no tenemos
 * curaduría para él — ahí el editor no dibuja el selector en vez de inventar
 * una elección que no se respeta.
 *
 * No expone llaves ni el modelo: sólo el nombre del proveedor y las voces.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json(
      { error: 'workspace_id required' },
      { status: 400 }
    );
  }
  if (!(await isVoiceMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const model = await getVoiceModelResolved(supabaseAdmin());
  // En realtime la voz la nombra el motor S2S, no el catálogo de TTS.
  const provider =
    model.mode === 'realtime' ? model.realtime_provider : model.tts_provider;
  if (provider?.toLowerCase() !== 'fish') {
    return NextResponse.json({
      provider,
      voices: CURATED_VOICES_BY_PROVIDER[provider ?? ''] ?? [],
    });
  }

  const { data: mine, error: mineError } = await supabaseAdmin()
    .from('workspace_voice_models')
    .select('provider_model_id, name, state')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'fish')
    .order('created_at', { ascending: false });
  if (mineError) {
    console.error('[voice/voices] workspace voices unavailable', mineError);
  }
  const apiKey = await fishKey();
  const ownVoices = apiKey
    ? await refreshCustomVoiceStates((mine ?? []) as WorkspaceVoice[], apiKey)
    : ((mine ?? []) as WorkspaceVoice[]);
  const custom = ownVoices.map((voice) => ({
    voice_id: voice.provider_model_id,
    label: voice.name,
    locale: 'es-419' as const,
    gender: 'female' as const,
    source: 'custom' as const,
    state: voice.state,
  }));

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get('search')?.trim().slice(0, 80);
  const tags = [
    allowedParam(searchParams.get('gender'), ['female', 'male'] as const),
    allowedParam(searchParams.get('age'), [
      'young',
      'middle-aged',
      'old',
    ] as const),
    allowedParam(searchParams.get('style'), [
      'conversational',
      'professional',
      'narration',
      'advertisement',
      'character-voice',
    ] as const),
    allowedParam(searchParams.get('tone'), [
      'calm',
      'energetic',
      'warm',
      'deep',
    ] as const),
  ].filter(isPresent);
  const sortBy =
    allowedParam(searchParams.get('sort'), [
      'score',
      'task_count',
      'created_at',
    ] as const) ?? 'score';
  const requestedPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isInteger(requestedPage)
    ? Math.max(1, Math.min(100, requestedPage))
    : 1;
  let library = CURATED_VOICES_BY_PROVIDER.fish.map((voice) => ({
    ...voice,
    source: 'library' as const,
  }));
  let libraryStatus: 'fish' | 'fallback' | 'unavailable' = 'fallback';
  let hasMore = false;
  let total: number | null = null;
  try {
    // El catálogo público de Fish no necesita una llave. Antes se ocultaba
    // completo cuando no había secreto local y además se enviaba `licensed`,
    // un filtro que Fish ya no soporta y que devolvía cero resultados.
    const listed = await fishLibraryPage(apiKey, page, search, tags, sortBy);
    library = listed.voices;
    hasMore = listed.hasMore;
    total = listed.total;
    libraryStatus = 'fish';
  } catch (error) {
    // La biblioteca no puede impedir elegir una voz propia o llamar. Las
    // voces verificadas siguen disponibles, pero NUNCA se presentan como si
    // fueran el catálogo en vivo de Fish.
    console.error('[voice/voices] Fish library unavailable', error);
  }
  return NextResponse.json({
    provider,
    voices: [...custom, ...library],
    library_status: libraryStatus,
    has_more: hasMore,
    total,
    page,
    page_size: FISH_LIBRARY_PAGE_SIZE,
  });
}

/** Crea un clon privado de Fish y lo asigna exclusivamente a este workspace. */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  const t = (key: string) => translate(locale, key);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: t('voice.voiceUnauthorized') },
      { status: 401 }
    );

  const form = await request.formData().catch(() => null);
  const workspaceId = form?.get('workspace_id');
  const name = form?.get('name');
  const consent = form?.get('consent');
  const samples =
    form
      ?.getAll('samples')
      .filter((file): file is File => file instanceof File) ?? [];
  if (
    typeof workspaceId !== 'string' ||
    typeof name !== 'string' ||
    consent !== 'true' ||
    !samples.length
  ) {
    return NextResponse.json(
      { error: t('voice.voiceCloneInvalid') },
      { status: 400 }
    );
  }
  if (!(await isVoiceAdmin(user.id, workspaceId))) {
    return NextResponse.json(
      { error: t('voice.voiceForbidden') },
      { status: 403 }
    );
  }
  if (
    name.trim().length > 80 ||
    samples.length > MAX_SAMPLES ||
    samples.some(
      (file) => file.size > MAX_SAMPLE_BYTES || !AUDIO_TYPES.has(file.type)
    )
  ) {
    return NextResponse.json(
      { error: t('voice.voiceCloneInvalid') },
      { status: 400 }
    );
  }

  const apiKey = await fishKey();
  if (!apiKey)
    return NextResponse.json(
      { error: t('voice.voiceFishUnavailable') },
      { status: 503 }
    );

  const fishForm = new FormData();
  fishForm.set('type', 'tts');
  fishForm.set('title', name.trim());
  fishForm.set('visibility', 'private');
  fishForm.set('train_mode', 'fast');
  fishForm.set('enhance_audio_quality', 'true');
  for (const file of samples) fishForm.append('voices', file, file.name);

  try {
    const res = await fetch(FISH_MODEL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: fishForm,
    });
    const payload = (await res.json().catch(() => null)) as FishModel | null;
    if (!res.ok || !isFishModelId(payload?._id)) {
      console.error('[voice/voices] Fish clone failed', res.status);
      return NextResponse.json(
        { error: t('voice.voiceCloneFailed') },
        { status: 502 }
      );
    }
    const state =
      payload.state === 'failed' ||
      payload.state === 'training' ||
      payload.state === 'trained'
        ? payload.state
        : 'created';
    const { error } = await supabaseAdmin()
      .from('workspace_voice_models')
      .insert({
        workspace_id: workspaceId,
        provider: 'fish',
        provider_model_id: payload._id,
        name: name.trim(),
        state,
        created_by: user.id,
      });
    if (error) throw error;
    return NextResponse.json({
      voice: {
        voice_id: payload._id,
        label: name.trim(),
        locale: 'es-419',
        gender: 'female',
        source: 'custom',
        state,
      },
    });
  } catch (error) {
    console.error('[voice/voices] clone failed', error);
    return NextResponse.json(
      { error: t('voice.voiceCloneFailed') },
      { status: 502 }
    );
  }
}
