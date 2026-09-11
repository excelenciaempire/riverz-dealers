export interface VoiceNoteConfig {
  template_id?: string;
  text?: string;
  voice_id?: string;
  media_url?: string;
}

export interface VoiceNoteTemplate {
  id: string;
  workspace_id: string;
  name: string;
  config: VoiceNoteConfig;
}

export const MAX_VOICE_NOTE_BYTES = 16 * 1024 * 1024;
export const MAX_VOICE_NOTE_CHARS = 2000;

/** Unknown variables are an error: never speak an incomplete order or price. */
export function renderVoiceText(
  text: string,
  variables: Record<string, unknown> = {}
): string {
  const rendered = text
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const plainKey = key.replace(/^vars\./, '');
      const value = Object.hasOwn(variables, key)
        ? variables[key]
        : Object.hasOwn(variables, plainKey)
          ? variables[plainKey]
          : undefined;
      if (value == null || typeof value === 'object')
        throw new Error('voiceNotes.variablesMissing');
      return String(value);
    })
    .trim();
  if (
    !rendered ||
    rendered.length > MAX_VOICE_NOTE_CHARS ||
    /\{\{|\}\}/.test(rendered)
  ) {
    throw new Error('voiceNotes.invalidText');
  }
  return rendered;
}

export function validVoiceConfig(value: unknown): value is VoiceNoteConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (
    Object.keys(c).some(
      (key) => !['template_id', 'media_url', 'text', 'voice_id'].includes(key)
    )
  )
    return false;
  if (Object.values(c).some((v) => typeof v !== 'string')) return false;
  if (c.voice_id && !/^[a-f0-9]{32}$/i.test(String(c.voice_id))) return false;
  const sources = [c.template_id, c.media_url, c.text].filter(
    (v) => typeof v === 'string' && v.trim()
  ).length;
  return (
    sources === 1 &&
    (!c.text ||
      (typeof c.text === 'string' && c.text.length <= MAX_VOICE_NOTE_CHARS))
  );
}
