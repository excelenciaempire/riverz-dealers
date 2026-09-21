'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useT } from '@/hooks/use-locale';
import { MAX_VOICE_NOTE_BYTES } from '@/lib/voice-notes/types';

export function VoiceRecorder({ disabled, onStart, onRecorded }: {
  disabled: boolean;
  onStart: () => void;
  onRecorded: (file: File) => void;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);

  function release() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }

  function stop(discard = false) {
    const active = recorder.current;
    if (discard) generation.current++;
    if (active?.state === 'recording') active.stop();
    release();
    setRecording(false);
  }

  useEffect(() => () => {
    generation.current++;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
  }, []);

  async function start() {
    if (requesting || recording || disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error(t('voiceNotes.recordUnsupported'));
      return;
    }
    const current = ++generation.current;
    setRequesting(true);
    onStart();
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = active;
      const chunks: Blob[] = [];
      let bytes = 0;
      active.ondataavailable = event => {
        if (!event.data.size || current !== generation.current) return;
        bytes += event.data.size;
        if (bytes > MAX_VOICE_NOTE_BYTES) {
          stop(true);
          toast.error(t('voiceNotes.invalidAudio'));
          return;
        }
        chunks.push(event.data);
      };
      active.onerror = () => {
        stop(true);
        toast.error(t('voiceNotes.recordFailed'));
      };
      active.onstop = () => {
        if (current !== generation.current) return;
        release();
        setRecording(false);
        const type = active.mimeType || chunks[0]?.type || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (!blob.size) {
          toast.error(t('voiceNotes.recordFailed'));
          return;
        }
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        onRecorded(new File([blob], `voice-${Date.now()}.${ext}`, { type }));
      };
      active.start(250);
      setSeconds(0);
      setRecording(true);
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 590) stop();
      }, 250);
    } catch (error) {
      if (current !== generation.current) return;
      release();
      toast.error(t(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'voiceNotes.micDenied' : 'voiceNotes.recordFailed'));
    } finally {
      if (current === generation.current) setRequesting(false);
    }
  }

  return <div className="flex items-center gap-3">
    {recording ? <>
      <span className="text-sm tabular-nums" role="timer" aria-label={t('voiceNotes.recording')}>
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
      <Button type="button" variant="outline" onClick={() => stop()}><Square className="size-4" />{t('voiceNotes.stopRecording')}</Button>
      <Button type="button" variant="ghost" size="icon" aria-label={t('voiceNotes.discardRecording')} onClick={() => stop(true)}><Trash2 className="size-4" /></Button>
    </> : <Button type="button" variant="outline" disabled={disabled || requesting} onClick={() => void start()}>
      <Mic className="size-4" />{t(requesting ? 'voiceNotes.micRequesting' : 'voiceNotes.record')}
    </Button>}
  </div>;
}
