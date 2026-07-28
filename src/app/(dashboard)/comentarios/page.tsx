'use client';

import {
  AgentSettingsMenu,
  CommentsSection,
  ConnectionPill,
  PausedBanner,
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
 * Mismo encabezado que Ventas por Instagram —título, aviso solo si falta la
 * conexión, límites en el menú— porque son dos caras del mismo agente.
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
        <div className="flex shrink-0 items-center gap-1.5">
          {connected === false && <ConnectionPill connected={false} />}
          <AgentSettingsMenu settings={settings} showOutreach={false} />
        </div>
      </header>

      <PausedBanner settings={settings} />

      <CommentsSection settings={settings} workspaceId={workspace?.id} />
    </div>
  );
}
