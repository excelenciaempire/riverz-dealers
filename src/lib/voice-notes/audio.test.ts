import { describe, expect, it } from 'vitest';
import { toVoiceAudio, inspectVoiceAudio } from './audio';

function wav() {
  const buffer = Buffer.alloc(44 + 48000 * 4);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(48000, 24);
  buffer.writeUInt32LE(192000, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}

describe('WhatsApp voice note audio compatibility', () => {
  it('converts stored Ogg to mono MP3 for social, email and web players', async () => {
    const ogg = await toVoiceAudio(wav());
    const mp3 = await toVoiceAudio(ogg, 'mp3');
    const metadata = await inspectVoiceAudio(mp3);
    expect(metadata.codec).toMatch(/MP3|MPEG/i);
    expect(metadata.numberOfChannels).toBe(1);
    expect(metadata.duration).toBeCloseTo(1, 0);
  });
  it('converts a stereo recording to mono Ogg/Opus without truncating it', async () => {
    const converted = await toVoiceAudio(wav());
    const metadata = await inspectVoiceAudio(converted);
    expect(metadata.container).toBe('Ogg');
    expect(metadata.codec?.toLowerCase()).toContain('opus');
    expect(metadata.numberOfChannels).toBe(1);
    expect(metadata.duration).toBeCloseTo(1, 1);
    expect(await toVoiceAudio(converted)).toBe(converted);
  });
  it('rejects mislabeled files and oversized uploads', async () => {
    await expect(
      toVoiceAudio(Buffer.from('<html>not audio</html>'))
    ).rejects.toThrow('voiceNotes.invalidAudio');
    await expect(
      toVoiceAudio(Buffer.alloc(16 * 1024 * 1024 + 1))
    ).rejects.toThrow('voiceNotes.invalidAudio');
  });
});
