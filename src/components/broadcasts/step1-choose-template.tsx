'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/hooks/use-locale';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  Authentication: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
};

/** Map a template status to its i18n key, resolved with t() at render. */
const STATUS_LABEL_KEYS: Record<string, string> = {
  Draft: 'broadcasts.statusDraft',
  Pending: 'broadcasts.statusPending',
  Approved: 'broadcasts.statusApproved',
  Rejected: 'broadcasts.statusRejected',
};

/**
 * Mirrors the StatusPill component in src/app/(dashboard)/plantillas/page.tsx
 * — kept inline (instead of importing) so this wizard step stays
 * self-contained for the v2 redesign.
 */
function StatusPill({ status }: { status: string }) {
  const t = useT();
  const tone =
    status === 'Approved'
      ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
      : status === 'Rejected'
        ? 'border-red-600/30 bg-red-500/10 text-red-600 dark:text-red-300'
        : status === 'Pending'
          ? 'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        tone,
      )}
    >
      {STATUS_LABEL_KEYS[status] ? t(STATUS_LABEL_KEYS[status]) : status}
    </span>
  );
}

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({ selectedTemplate, onSelect, onNext, onBack }: Step1Props) {
  const t = useT();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('broadcasts.templatesLoadError'));
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent-ink" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('broadcasts.step1Title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('broadcasts.step1Subtitle')}
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
          <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('broadcasts.noTemplates')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('broadcasts.noTemplatesHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            const isSendable = template.status === 'Approved';
            const catColor = categoryColors[template.category] ?? categoryColors.Utility;
            const rejectedReason = (
              template as MessageTemplate & { rejected_reason?: string | null }
            ).rejected_reason;

            return (
              <button
                key={template.id}
                onClick={() => {
                  // Block selection of non-Approved templates so the
                  // merchant can't submit a campaign Meta will reject
                  // with error #132001 at send time.
                  if (!isSendable) return;
                  onSelect(template);
                }}
                disabled={!isSendable}
                aria-disabled={!isSendable}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border p-4 text-left transition-all',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border bg-card/50 hover:border-foreground/30 hover:bg-card',
                  !isSendable && 'cursor-not-allowed opacity-60 hover:border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                  >
                    {template.category}
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-muted-foreground">{template.body_text}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{template.language ?? 'en_US'}</span>
                  <span>-</span>
                  <StatusPill status={template.status ?? 'Draft'} />
                </div>
                {template.status === 'Rejected' && rejectedReason && (
                  <p className="text-[10px] text-red-600 dark:text-red-400">
                    {rejectedReason}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-foreground">
          {t('broadcasts.back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!selectedTemplate || selectedTemplate.status !== 'Approved'}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('broadcasts.next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
