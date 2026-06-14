'use client';

import Link from 'next/link';
import { ArrowLeft, Blocks } from 'lucide-react';
import { ChannelsPanel } from '@/components/settings/channels-panel';

/**
 * /integraciones — todas las apps externas y canales que se conectan a
 * la cuenta (WhatsApp, Meta, Google, Microsoft, Shopify). Antes vivía
 * como un tab dentro de /ajustes; ahora es su propia página para que
 * el onboarding ("conectá WhatsApp", "conectá Shopify") tenga un home
 * propio y no se mezcle con perfil / equipo / etiquetas.
 *
 * El componente `<ChannelsPanel/>` ya estaba escrito y maneja todos
 * los providers — sólo lo movemos de lugar.
 */
export default function IntegracionesPage() {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Blocks className="size-3.5" />
          Configuración
        </div>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Integraciones</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Conectá WhatsApp, Shopify, Gmail, Outlook, Facebook e Instagram para
          que tu equipo trabaje desde una sola bandeja y los bots tengan
          contexto de tu tienda.
        </p>
        <Link
          href="/ajustes"
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Volver a Ajustes
        </Link>
      </div>

      <ChannelsPanel />
    </div>
  );
}
