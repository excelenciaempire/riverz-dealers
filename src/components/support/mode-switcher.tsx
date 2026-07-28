'use client';

import Link from "@/components/i18n/locale-link";
import { Sparkles, Waypoints, ArrowRight } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { isFeatureEnabled } from '@/lib/admin/feature-flags';

/**
 * Side-by-side picker shown at the top of /ai and /flows so the user
 * always sees the two ways to set up customer service and can switch
 * between them. The current mode is highlighted; the other reads as a
 * subtle link.
 */
export function SupportModeSwitcher({ current }: { current: 'ai' | 'flows' }) {
  const t = useT();
  const { flags } = useFeatureFlags();
  // Si Flujos está apagado (feature flag), el chooser deja de tener sentido
  // (queda un solo modo) → se oculta entero, incl. la tarjeta del Asistente.
  if (!isFeatureEnabled(flags, 'flows')) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ModeCard
        href="/asistente"
        icon={<Sparkles className="size-4" />}
        title={t('metrics.modeAiTitle')}
        hint={t('metrics.modeAiHint')}
        active={current === 'ai'}
      />
      <ModeCard
        href="/menus"
        icon={<Waypoints className="size-4" />}
        title={t('metrics.modeFlowsTitle')}
        hint={t('metrics.modeFlowsHint')}
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
