'use client';

import {
  CommentsSection,
  ConnectionPill,
  useIgConnected,
  useProactiveSettings,
} from '@/components/instagram/sections';
import { useT } from '@/hooks/use-locale';
import { useWorkspace } from '@/hooks/use-workspace';

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
 *
 * Aquí NO viven el tope diario ni el freno de emergencia, aunque los dos
 * afecten a lo que sale de esta pantalla. Son controles de reputación de la
 * cuenta —su propio texto habla de "DMs proactivos"— y se configuran en
 * Prospección IA. Lo que un comercio usa para callar los comentarios es el
 * interruptor que tiene delante: "Responder con IA".
 */
export default function ComentariosPage() {
  const t = useT();
  const settings = useProactiveSettings();
  const connected = useIgConnected();
  const { workspace } = useWorkspace();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="app-page-title">{t('nav.comments')}</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {t('igAgent.commentsSubtitle')}
          </p>
        </div>
        {connected === false && <ConnectionPill connected={false} />}
      </header>

      <CommentsSection settings={settings} workspaceId={workspace?.id} />
    </div>
  );
}
