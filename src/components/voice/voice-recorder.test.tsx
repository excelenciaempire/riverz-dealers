import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { VoiceRecorder } from './voice-recorder';
import { toast } from 'sonner';
const lifecycle = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => lifecycle.cleanups.push(effect()),
}));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

class Recorder {
  static current: Recorder;
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  constructor() { Recorder.current = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    // Browsers emit the last chunk only after stop(), before onstop.
    this.ondataavailable?.({ data: new Blob(['final audio']) });
    this.onstop?.();
  }
}
function start(onRecorded = vi.fn()) {
  const ui = VoiceRecorder({ disabled: false, onStart: vi.fn(), onRecorded });
  const button = ui.props.children as ReactElement<{ onClick: () => void }>;
  button.props.onClick();
  return onRecorded;
}
const stopTrack = vi.fn();
const media = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(media) } });
});
afterEach(() => {
  lifecycle.cleanups.splice(0).forEach(cleanup => cleanup());
  vi.unstubAllGlobals();
});
describe('voice recording lifecycle', () => {
  it('keeps the final audio chunk and releases the microphone on stop', async () => {
    const recorded = start();
    await vi.waitFor(() => expect(Recorder.current.state).toBe('recording'));
    Recorder.current.stop();
    expect(stopTrack).toHaveBeenCalled();
    const file = recorded.mock.calls[0][0] as File;
    expect(await file.text()).toBe('final audio');
    expect(file.type).toBe('audio/webm;codecs=opus');
  });
  it('discards recording on close instead of uploading it', async () => {
    const recorded = start();
    await vi.waitFor(() => expect(Recorder.current.state).toBe('recording'));
    lifecycle.cleanups.splice(0).forEach(cleanup => cleanup());
    expect(stopTrack).toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
  });
  it('releases a late microphone permission grant after closing', async () => {
    let grant!: (value: typeof media) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(resolve => { grant = resolve as typeof grant; }));
    const recorded = start();
    lifecycle.cleanups.splice(0).forEach(cleanup => cleanup());
    grant(media);
    await vi.waitFor(() => expect(stopTrack).toHaveBeenCalled());
    expect(recorded).not.toHaveBeenCalled();
  });
  it('shows a useful permission error without producing an audio', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const recorded = start();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('voiceNotes.micDenied'));
    expect(recorded).not.toHaveBeenCalled();
  });
});
