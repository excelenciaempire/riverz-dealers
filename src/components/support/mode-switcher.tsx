'use client';

import Link from 'next/link';
import { Sparkles, Waypoints, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Side-by-side picker shown at the top of /ai and /flows so the user
 * always sees the two ways to set up customer service and can switch
 * between them. The current mode is highlighted; the other reads as a
 * subtle link.
 */
export function SupportModeSwitcher({ current }: { current: 'ai' | 'flows' }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ModeCard
        href="/asistente"
        icon={<Sparkles className="size-4" />}
        title="Asistente con IA"
        hint="Responde solo, 24/7, con el contexto de cada chat."
        active={current === 'ai'}
      />
      <ModeCard
        href="/menus"
        icon={<Waypoints className="size-4" />}
        title="Flujos"
        hint="Botones que tú defines; el cliente toca y avanza, sin IA."
        active={current === 'flows'}
      />
    </div>
  );
}

function ModeCard({
  href,
  icon,
  title,
  hint,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
        active
          ? 'border-primary/50 bg-primary/5'
          : 'border-border bg-card hover:border-foreground/30',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      {!active && (
        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </Link>
  );
}
