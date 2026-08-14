'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from '@/components/i18n/locale-link';
import { MessageSquare } from 'lucide-react';
import { channelDisplay, channelLabel } from '@/lib/channels/display';
import { useT } from '@/hooks/use-locale';
import type { Channel } from '@/types';

interface ChatLink {
  id: string;
  channel: Channel;
}

/**
 * Atajo de la ficha del contacto a su conversación en la bandeja: un botón por
 * canal con hilo abierto (el más reciente de cada uno), que abre el hilo con el
 * deep-link `?c=<id>` que la bandeja ya entiende. Si el contacto no tiene
 * ninguna conversación no se renderiza nada.
 */
export function ContactChatLinks({ contactId }: { contactId: string | null }) {
  const t = useT();
  // Los enlaces viajan junto al contacto al que pertenecen: así, al cambiar de
  // ficha, no se muestran por un instante los del contacto anterior (y el
  // estado se escribe sólo dentro del await, nunca en el cuerpo del efecto).
  const [state, setState] = useState<{ contactId: string; links: ChatLink[] } | null>(null);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from('conversations')
        .select('id, channel, last_message_at')
        .eq('contact_id', contactId)
        .is('deleted_at', null)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50);
      if (cancelled) return;
      const seen = new Set<Channel>();
      const links: ChatLink[] = [];
      for (const row of (data ?? []) as ChatLink[]) {
        if (seen.has(row.channel)) continue;
        seen.add(row.channel);
        links.push({ id: row.id, channel: row.channel });
      }
      setState({ contactId, links });
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const links = state && state.contactId === contactId ? state.links : [];
  if (links.length === 0) return null;

  // Con un solo canal el botón dice qué hace ("Ver chat"); con varios, cada uno
  // dice a qué canal lleva.
  const single = links.length === 1;

  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((link) => (
        <Link
          key={link.id}
          href={`/bandeja?c=${link.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <MessageSquare
            className="size-3.5"
            style={{ color: channelDisplay(link.channel).accent }}
          />
          {single ? t('contacts.openChat') : channelLabel(link.channel, t)}
        </Link>
      ))}
    </div>
  );
}
