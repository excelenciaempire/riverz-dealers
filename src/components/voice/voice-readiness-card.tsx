'use client';

import {
  CheckCircle2,
  CircleAlert,
  PhoneIncoming,
  PhoneOutgoing,
} from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import type { VoiceReadinessView } from '@/hooks/use-voice-readiness';
import { VOICE_BLOCKED_KEY } from '@/lib/voice/labels';

function Direction({
  icon: Icon,
  title,
  ready,
  fallback,
  issues,
}: {
  icon: typeof PhoneOutgoing;
  title: string;
  ready: boolean;
  fallback?: boolean;
  issues: VoiceReadinessView['outbound']['blockers'];
}) {
  const t = useT();
  const primary = issues[0];
  return (
    <div className="border-border rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4" /> {title}
        </span>
        <span className={ready ? 'text-emerald-600' : 'text-destructive'}>
          {ready ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <CircleAlert className="size-4" />
          )}
        </span>
      </div>
      <p className="text-muted-foreground mt-1.5 text-xs">
        {ready
          ? fallback
            ? t('voice.readinessFallback')
            : t('voice.readinessReady')
          : primary
            ? t(VOICE_BLOCKED_KEY[primary.code])
            : t('voice.readinessUnavailable')}
        {!ready && primary?.fixHref && (
          <>
            {' '}
            ·{' '}
            <Link href={primary.fixHref} className="underline">
              {t('voice.blockedFix')}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

export function VoiceReadinessCard({
  readiness,
}: {
  readiness: VoiceReadinessView | null;
}) {
  const t = useT();
  if (!readiness) return null;
  const inboundIssues = readiness.inbound.ready
    ? readiness.inbound.warnings
    : readiness.inbound.blockers;
  const origins = [
    'voice.readinessOriginManual',
    'voice.readinessOriginTest',
    'voice.readinessOriginAssistant',
    'voice.readinessOriginAutomation',
    'voice.readinessOriginCampaign',
    'voice.readinessOriginOperator',
    'voice.readinessOriginRetry',
    'voice.readinessOriginInbound',
  ];
  return (
    <section className="border-border bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Direction
          icon={PhoneOutgoing}
          title={t('voice.readinessOutbound')}
          ready={readiness.outbound.ready}
          issues={readiness.outbound.blockers}
        />
        <Direction
          icon={PhoneIncoming}
          title={t('voice.readinessInbound')}
          ready={readiness.inbound.ready}
          fallback={readiness.inbound.mode === 'fallback'}
          issues={inboundIssues}
        />
      </div>
      <p className="border-border bg-muted/20 text-muted-foreground mt-3 rounded-lg border px-3 py-2 text-xs">
        {t('voice.voiceRoutingRule')}
      </p>
      <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {origins.map((key) => (
          <span key={key}>{t(key)}</span>
        ))}
      </div>
    </section>
  );
}
