"use client";

import { useEffect, useRef } from 'react';
import { FileText, X } from 'lucide-react';
import { useT } from '@/hooks/use-locale';

export function AttachmentPreview({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const t = useT();
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = previewRef.current?.querySelector('img,video,audio');
    if (!media) return;
    const src = URL.createObjectURL(file);
    media.setAttribute('src', src);
    return () => URL.revokeObjectURL(src);
  }, [file]);
  return (
    <div className="relative w-36 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/40">
      <div ref={previewRef} className="flex h-28 items-center justify-center overflow-hidden bg-background">
        {file.type.startsWith('image/') ? (
          // Local blob preview, never a remote image to optimize.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={file.name} className="h-full w-full object-contain" />
        ) : file.type.startsWith('video/') ? (
          <video controls preload="metadata" className="h-full w-full object-contain" />
        ) : file.type.startsWith('audio/') ? (
          <audio controls preload="metadata" className="w-full" />
        ) : <FileText className="size-9 text-muted-foreground" />}
      </div>
      <div className="truncate px-2 py-2 text-xs" title={file.name}>{file.name}</div>
      <button type="button" disabled={disabled} onClick={onRemove} aria-label={t('inbox.removeNamedAttachment', { name: file.name })}
        className="absolute right-1 top-1 rounded-full border border-border bg-background/95 p-1 text-foreground shadow-sm hover:bg-accent disabled:opacity-40">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
