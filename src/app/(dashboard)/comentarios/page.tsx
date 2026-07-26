'use client';

import { MessageSquareReply } from 'lucide-react';
import {
  CommentsSection,
  ConnectionPill,
  ProactiveLimits,
  useIgConnected,
  useProactiveSettings,
} from '@/components/instagram/sections';
import { useT } from '@/hooks/use-locale';

/**
 * Comentarios — una de las tres cosas que Riverz automatiza, con su propia
 * entrada en el menú y nada más alrededor.
 *
 * Vive en "Servicio al cliente" a propósito: responder a quien comenta es
 * atender, no vender. Salir a buscar gente es otra cosa y tiene su propia
 * página (Ventas por Instagram). Esa separación en el menú es la que explica
 * la diferencia sin que nadie tenga que leer nada.
 *
 * Cubre Instagram y Facebook: las reglas de comentario→DM ya funcionan en los
 * dos, así que el nombre no lleva apellido de canal.
 */
export default function ComentariosPage() {
  const t = useT();
  const settings = useProactiveSettings();
  const connected = useIgConnected();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent/60 text-accent-ink shadow-sm">
            <MessageSquareReply className="h-5 w-5" />
          </span>
          <h1 className="app-page-title">{t('nav.comments')}</h1>
        </div>
        <ConnectionPill connected={connected} />
      </header>


      <CommentsSection settings={settings} />

      <ProactiveLimits settings={settings} />
    </div>
  );
}
