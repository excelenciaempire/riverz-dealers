import { describe, expect, it } from 'vitest';
import { renderVoiceText, validVoiceConfig } from './types';

describe('voice note configuration and personalization', () => {
  it('preserves accents and replaces each recipient independently', () => {
    expect(
      renderVoiceText('Hola {{name}}, pedido {{vars.order}}.', {
        name: 'José',
        order: '42',
      })
    ).toBe('Hola José, pedido 42.');
    expect(renderVoiceText('Hola {{name}}.', { name: 'Ana' })).toBe(
      'Hola Ana.'
    );
  });
  it('fails rather than speaking an incomplete price or unresolved token', () => {
    expect(() => renderVoiceText('{{constructor}}')).toThrow(
      'voiceNotes.variablesMissing'
    );
    expect(() => renderVoiceText('Tu total es {{price}}')).toThrow(
      'voiceNotes.variablesMissing'
    );
    expect(() =>
      renderVoiceText('Hola {{name}}', { name: '{{price}}' })
    ).toThrow('voiceNotes.invalidText');
    expect(() => renderVoiceText('a'.repeat(2001))).toThrow(
      'voiceNotes.invalidText'
    );
  });
  it('requires one source and a valid Fish voice', () => {
    expect(
      validVoiceConfig({ text: '{{reply}}', voice_id: 'a'.repeat(32) })
    ).toBe(true);
    expect(
      validVoiceConfig({ media_url: '/api/media/workspace/voice-notes/id.ogg' })
    ).toBe(true);
    for (const bad of [
      null,
      {},
      { text: '' },
      { text: 'hola', media_url: 'x' },
      { text: 'hola', voice_id: 123 },
      { text: 'hola', voice_id: 'eleven-voice' },
      { text: 'hola', workspace_id: 'other' },
    ])
      expect(validVoiceConfig(bad)).toBe(false);
  });
});
