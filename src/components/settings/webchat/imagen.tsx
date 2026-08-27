'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

const MAX_BYTES = 2 * 1024 * 1024;
const TIPOS = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * La imagen del chat, elegida desde la computadora.
 *
 * Antes esto era un campo de texto que pedía una URL `https://`. Daba por hecho
 * que el comercio ya tiene su logo publicado y sabe copiar su dirección — dos
 * cosas que casi nunca pasan, así que el campo quedaba vacío y el chat salía a
 * la tienda sin cara.
 *
 * Se sube y se guarda en el mismo gesto: un "elegir archivo" que después
 * necesita un "guardar" es la mitad de la gente que no lo guarda.
 */
export function ImagenDelChat({
  url,
  onChange,
  fallback,
}: {
  url: string | null;
  onChange: (url: string) => void;
  /** Iniciales de la marca, para cuando no hay imagen. */
  fallback: string;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  async function subir(file: File) {
    if (!TIPOS.has(file.type)) {
      toast.error(t('webchat.imageBadType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('webchat.imageTooLarge'));
      return;
    }
    setSubiendo(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetchWithCsrf('/api/webchat/avatar', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.url) throw new Error('upload');
      onChange(json.url as string);
    } catch {
      toast.error(t('webchat.imageFailed'));
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen del comercio en un dominio que no controlamos
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          fallback
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void subir(file);
        }}
      />

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={subiendo}
        onClick={() => input.current?.click()}
      >
        {subiendo ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ImagePlus className="size-3.5" />
        )}
        <span className="ml-1.5">{t('webchat.imageUpload')}</span>
      </Button>

      {url ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label={t('webchat.imageRemove')}
          title={t('webchat.imageRemove')}
          onClick={() => onChange('')}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
