'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import type { Channel } from '@/types';
import { voiceRequiresWindow } from '@/lib/voice-notes/channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_VOICE_NOTE_BYTES,
  validVoiceConfig,
  type VoiceNoteConfig,
  type VoiceNoteTemplate,
} from '@/lib/voice-notes/types';

export function VoiceNoteEditor({
  value,
  onChange,
  agent = false,
  channel,
}: {
  value: VoiceNoteConfig | null;
  onChange: (value: VoiceNoteConfig | null) => void;
  agent?: boolean;
  channel?: Channel;
}) {
  const { workspace } = useWorkspace();
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [templates, setTemplates] = useState<VoiceNoteTemplate[]>([]);
  const [voices, setVoices] = useState<{ voice_id: string; label: string }[]>(
    []
  );
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [name, setName] = useState('');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const script = value?.template_id
    ? templates.find((item) => item.id === value.template_id)?.config.text
    : value?.text;
  const variableKeys = [
    ...new Set(
      Array.from(
        (script ?? '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g),
        (match) => match[1]
      )
    ),
  ];
  const [mode, setMode] = useState(
    value?.template_id
      ? 'saved'
      : value?.media_url
        ? 'upload'
        : value
          ? 'fish'
          : 'textMode'
  );
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    fetch(`/api/voice-notes?workspace_id=${workspace.id}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) setTemplates(data.templates ?? []);
      })
      .catch(() => {
        /* The editor can still create a note before the library is available. */
      });
    return () => {
      active = false;
    };
  }, [workspace]);
  useEffect(() => {
    if (!workspace || mode !== 'fish') return;
    const controller = new AbortController();
    fetch(`/api/voice/voices?workspace_id=${workspace.id}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.provider === 'fish')
          setVoices(
            (data.voices ?? []).filter(
              (v: { state?: string }) => !v.state || v.state === 'trained'
            )
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [workspace, mode]);

  async function act(action: 'preview' | 'save', freeze = false) {
    if (!workspace || !value || busy) return;
    setBusy(true);
    try {
      const response = await fetchWithCsrf('/api/voice-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          workspace_id: workspace.id,
          config: freeze ? { media_url: preview } : value,
          variables: samples,
          name,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (action === 'preview') setPreview(data.url);
      else {
        setTemplates((old) => [...old, data.template]);
        setName('');
        toast.success(t('voiceNotes.savedOk'));
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('voiceNotes.failed')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span>{t('voiceNotes.title')}</span>
        <select
          className="bg-background w-full rounded-md border p-2"
          value={mode}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value;
            setMode(next);
            setPreview('');
            onChange(
              next === 'textMode'
                ? null
                : next === 'fish'
                  ? { text: agent ? '{{reply}}' : '' }
                  : next === 'saved'
                    ? { template_id: '' }
                    : { media_url: '' }
            );
          }}
        >
          {['textMode', 'fish', 'saved', 'upload'].map((k) => (
            <option key={k} value={k}>
              {t(`voiceNotes.${k}`)}
            </option>
          ))}
        </select>
      </label>
      {mode === 'fish' && (
        <>
          {agent ? (
            <p className="text-muted-foreground text-xs">
              {t('voiceNotes.agentHint')}
            </p>
          ) : (
            <label className="block space-y-1 text-sm">
              <span>{t('voiceNotes.script')}</span>
              <Textarea
                maxLength={2000}
                value={value?.text ?? ''}
                onChange={(e) => {
                  onChange({ ...value, text: e.target.value });
                  setPreview('');
                }}
              />
              <span className="text-muted-foreground text-xs">
                {t('voiceNotes.variables')}
              </span>
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span>{t('voiceNotes.voice')}</span>
            <select
              className="bg-background w-full rounded-md border p-2"
              value={value?.voice_id ?? ''}
              onChange={(e) => {
                onChange({ ...value, voice_id: e.target.value });
                setPreview('');
              }}
            >
              <option value="">{t('voiceNotes.defaultVoice')}</option>
              {value?.voice_id &&
                !voices.some((v) => v.voice_id === value.voice_id) && (
                  <option value={value.voice_id}>{value.voice_id}</option>
                )}
              {voices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {mode === 'saved' && (
        <label className="block space-y-1 text-sm">
          <span>{t('voiceNotes.saved')}</span>
          <select
            className="bg-background w-full rounded-md border p-2"
            value={value?.template_id ?? ''}
            onChange={(e) => {
              onChange({ template_id: e.target.value });
              setPreview('');
            }}
          >
            <option value="">{t('voiceNotes.choose')}</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === 'upload' && (
        <label className="block space-y-1 text-sm">
          <span>{t('voiceNotes.upload')}</span>
          <Input
            type="file"
            accept=".mp3,.m4a,.wav,.ogg,.opus,.flac,audio/*"
            disabled={busy || !workspace}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !workspace) return;
              if (file.size > MAX_VOICE_NOTE_BYTES) {
                toast.error(t('voiceNotes.invalidAudio'));
                return;
              }
              setBusy(true);
              try {
                const form = new FormData();
                form.append('workspace_id', workspace.id);
                form.append('file', file);
                const response = await fetchWithCsrf('/api/voice-notes', {
                  method: 'POST',
                  body: form,
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                onChange({ media_url: data.url });
                setPreview(data.url);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : t('voiceNotes.failed')
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          <span className="text-muted-foreground text-xs">
            {t('voiceNotes.format')}
          </span>
        </label>
      )}
      {value && (
        <>
          <p className="text-muted-foreground text-xs">
            {t(channel ? (voiceRequiresWindow(channel) ? 'voiceNotes.window' : 'voiceNotes.channelAudio') : 'voiceNotes.supportedChannels')}
          </p>
          {!agent && variableKeys.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-muted-foreground text-xs">
                {t('voiceNotes.samples')}
              </legend>
              {variableKeys.map((key) => (
                <label key={key} className="block text-sm">
                  <span>{key}</span>
                  <Input
                    value={samples[key] ?? ''}
                    maxLength={2000}
                    onChange={(e) =>
                      setSamples((old) => ({ ...old, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </fieldset>
          )}
          {!agent && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || !validVoiceConfig(value)}
              onClick={() => void act('preview')}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('voiceNotes.preview')}
            </Button>
          )}
          {preview && <audio className="w-full" controls src={preview} />}
          {!agent && mode !== 'saved' && (
            <div className="flex flex-wrap gap-2">
              <Input
                className="basis-full"
                aria-label={t('voiceNotes.name')}
                placeholder={t('voiceNotes.name')}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy || !name.trim() || !validVoiceConfig(value)}
                onClick={() => void act('save')}
              >
                {t('voiceNotes.save')}
              </Button>
              {preview && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !name.trim()}
                  onClick={() => void act('save', true)}
                >
                  {t('voiceNotes.saveAudio')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function VoiceNoteComposer({
  conversationId,
  disabled,
  channel,
}: {
  conversationId: string;
  disabled: boolean;
  channel: Channel;
}) {
  const { workspace } = useWorkspace();
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<VoiceNoteConfig | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        title={t('voiceNotes.title')}
        aria-label={t('voiceNotes.title')}
        disabled={disabled || busy}
        onClick={() => setOpen(!open)}
      >
        <Mic className="size-4" />
      </Button>
      {open && (
        <div className="bg-background absolute bottom-full left-0 z-40 mb-2 max-h-[70vh] w-full max-w-md space-y-4 overflow-auto rounded-xl border p-4 shadow-lg">
          <VoiceNoteEditor value={value} onChange={setValue} channel={channel} />
          <Button
            type="button"
            disabled={
              disabled || busy || !workspace || !validVoiceConfig(value)
            }
            onClick={async () => {
              if (!workspace || busy) return;
              setBusy(true);
              try {
                const response = await fetchWithCsrf('/api/voice-notes', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'send',
                    workspace_id: workspace.id,
                    conversation_id: conversationId,
                    config: value,
                  }),
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                toast.success(t('voiceNotes.sent'));
                setOpen(false);
                setValue(null);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : t('voiceNotes.failed')
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('voiceNotes.send')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function VoiceNoteLibrary() {
  const t = useT();
  const [value, setValue] = useState<VoiceNoteConfig | null>(null);
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {t('voiceNotes.title')}
      </summary>
      <div className="mt-4 max-w-xl space-y-4">
        <p className="text-muted-foreground text-sm">
          {t('voiceNotes.libraryHint')}
        </p>
        <VoiceNoteEditor value={value} onChange={setValue} />
      </div>
    </details>
  );
}
