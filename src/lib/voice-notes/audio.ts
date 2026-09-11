import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { parseBuffer } from 'music-metadata';
import { MAX_VOICE_NOTE_BYTES } from './types';

const execute = promisify(execFile);

/** Never trust an extension or MIME supplied by an uploader. */
export async function inspectVoiceAudio(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_VOICE_NOTE_BYTES)
    throw new Error('voiceNotes.invalidAudio');
  const metadata = await parseBuffer(buffer, undefined, {
    duration: true,
  }).catch(() => null);
  if (
    !metadata?.format.codec ||
    !metadata.format.numberOfChannels ||
    !metadata.format.duration ||
    metadata.format.duration > 600
  )
    throw new Error('voiceNotes.invalidAudio');
  return metadata.format;
}

export async function toVoiceAudio(buffer: Buffer, target: 'ogg' | 'mp3' = 'ogg'): Promise<Buffer> {
  const format = await inspectVoiceAudio(buffer);
  if (
    target === 'ogg' && format.container === 'Ogg' &&
    format.codec?.toLowerCase().includes('opus') &&
    format.numberOfChannels === 1
  )
    return buffer;
  if (!ffmpeg) throw new Error('voiceNotes.failed');
  const directory = await mkdtemp(join(tmpdir(), 'riverz-voice-note-'));
  const source = join(directory, 'input');
  const output = join(directory, `voice.${target}`);
  try {
    await writeFile(source, buffer);
    await execute(
      ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'wav,mp3,mov,ogg,flac,aac',
        '-i',
        source,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        target === 'ogg' ? 'libopus' : 'libmp3lame',
        '-b:a',
        '32k',
        '-threads',
        '1',
        '-t',
        '601',
        '-y',
        output,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true }
    );
    const result = await readFile(output);
    await inspectVoiceAudio(result);
    return result;
  } catch {
    throw new Error('voiceNotes.invalidAudio');
  } finally {
    await unlink(source).catch(() => {});
    await unlink(output).catch(() => {});
    await rmdir(directory).catch(() => {});
  }
}
