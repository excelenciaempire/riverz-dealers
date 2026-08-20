'use client';

import { useState } from 'react';

/**
 * El adjunto de una burbuja.
 *
 * Una imagen se muestra; lo demás se ofrece para abrir. Es la diferencia entre
 * que el comercio mande la foto del producto —o el cliente la del paquete que
 * llegó roto— y que del otro lado no pase nada.
 *
 * La URL apunta a `/api/widget/media/…`, que autoriza con el token del chat y
 * sólo entrega adjuntos de la conversación de quien pregunta. No se puede usar
 * la del panel: exige sesión de Riverz y para un visitante siempre da 401.
 */

export interface Media {
  url: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  name?: string;
}

export function MessageMedia({ media }: { media: Media }) {
  const [roto, setRoto] = useState(false);

  if (media.kind === 'image' && !roto) {
    return (
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="mt-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={media.name ?? ''}
          // `max-h` acotado: una foto vertical de teléfono ocupaba el chat
          // entero y empujaba la conversación fuera de la vista.
          className="max-h-64 w-auto max-w-full rounded-lg object-cover"
          loading="lazy"
          onError={() => setRoto(true)}
        />
      </a>
    );
  }

  if (media.kind === 'video' && !roto) {
    return (
      <video
        src={media.url}
        controls
        preload="metadata"
        className="mt-1 max-h-64 w-full rounded-lg"
        onError={() => setRoto(true)}
      />
    );
  }

  if (media.kind === 'audio' && !roto) {
    return (
      <audio src={media.url} controls preload="metadata" className="mt-1 w-full"
             onError={() => setRoto(true)} />
    );
  }

  // Un archivo cualquiera —o una imagen que no cargó, que suele ser una firma
  // vencida— se ofrece como enlace: siempre es mejor que un cuadro roto.
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-2 rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-sm underline-offset-2 hover:underline"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="truncate">{media.name || 'Abrir archivo'}</span>
    </a>
  );
}
