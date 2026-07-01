'use client';

import { useState } from 'react';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, Clock, MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
  /** ISO local datetime string for a scheduled send, or '' for immediate. */
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
  createConversations: boolean;
  onCreateConversationsChange: (value: boolean) => void;
  /**
   * Audience size as computed by Step2 (single source of truth — Step2
   * already filters opted_out, invalid phones, workspace, excludes,
   * custom_field, and segment audiences). Step4's old local
   * `calculateReach` diverged on every one of those.
   */
  estimatedCount: number | null;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
  scheduledAt,
  onScheduledAtChange,
  createConversations,
  onCreateConversationsChange,
  estimatedCount,
}: Step4Props) {
  const t = useT();
  const fmt = useFormat();
  const isScheduled = scheduledAt.trim().length > 0;
  const [showConfirm, setShowConfirm] = useState(false);
  const loadingReach = estimatedCount === null;
  const estimatedReach = estimatedCount ?? 0;

  const audienceLabel =
    audience.type === 'all'
      ? t('broadcasts.audienceAllLabel')
      : audience.type === 'tags'
        ? t('broadcasts.audienceTagsCount', { n: audience.tagIds?.length ?? 0 })
        : audience.type === 'csv'
          ? t('broadcasts.audienceCsvUpload')
          : t('broadcasts.audienceCustom');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('broadcasts.step4Title')}</h2>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('broadcasts.broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('broadcasts.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('broadcasts.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('broadcasts.template')}</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('broadcasts.audience')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('broadcasts.estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-accent-ink" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-accent-ink" />
                  <p className="font-medium text-foreground">{fmt.number(estimatedReach)}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('broadcasts.language')}</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Send timing */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">{t('broadcasts.whenToSend')}</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onScheduledAtChange('')}
            className={cn(
              'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              !isScheduled
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <Send className="h-3.5 w-3.5" /> {t('broadcasts.sendNow')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isScheduled) {
                // Default to ~1 hour from now in the input's local format.
                const d = new Date(Date.now() + 60 * 60 * 1000);
                const pad = (n: number) => String(n).padStart(2, '0');
                onScheduledAtChange(
                  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                );
              }
            }}
            className={cn(
              'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              isScheduled
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <Clock className="h-3.5 w-3.5" /> {t('broadcasts.schedule')}
            </span>
          </button>
        </div>
        {isScheduled && (
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => onScheduledAtChange(e.target.value)}
            className="border-border bg-muted text-foreground"
          />
        )}
      </div>

      {/* Create conversations toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-accent-ink" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('broadcasts.createConversations')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('broadcasts.createConversationsHint')}
            </p>
          </div>
        </div>
        <Switch
          checked={createConversations}
          onCheckedChange={onCreateConversationsChange}
        />
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-accent-ink" />
              <p className="text-sm font-medium text-foreground">{t('broadcasts.sendingBroadcast')}</p>
            </div>
            <span className="text-xs font-medium text-accent-ink">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('broadcasts.back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-foreground hover:bg-accent disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('broadcasts.saveAsDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                disabled={!name.trim() || isProcessing}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            {isScheduled ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {isScheduled ? t('broadcasts.scheduleBroadcast') : t('broadcasts.sendBroadcast')}
          </DialogTrigger>
          <DialogContent className="border-border bg-card sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground">
                {isScheduled ? t('broadcasts.scheduleBroadcast') : t('broadcasts.confirmBroadcast')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {isScheduled ? (
                  <>
                    {t('broadcasts.confirmScheduledPart1')}{' '}
                    <span className="font-medium text-foreground">
                      {fmt.number(estimatedReach)}
                    </span>{' '}
                    {t('broadcasts.confirmScheduledPart2')}{' '}
                    <span className="font-medium text-foreground">
                      {fmt.dateTime(scheduledAt, {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </span>{' '}
                    {t('broadcasts.confirmScheduledPart3')}{' '}
                    <span className="font-medium text-foreground">{template.name}</span>.
                  </>
                ) : (
                  <>
                    {t('broadcasts.confirmImmediatePart1')}{' '}
                    <span className="font-medium text-foreground">
                      {fmt.number(estimatedReach)}
                    </span>{' '}
                    {t('broadcasts.confirmImmediatePart2')}{' '}
                    <span className="font-medium text-foreground">{template.name}</span>.
                    {' '}{t('broadcasts.confirmImmediatePart3')}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-foreground"
              >
                {t('broadcasts.cancel')}
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend();
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isScheduled ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {isScheduled ? t('broadcasts.confirmAndSchedule') : t('broadcasts.confirmAndSend')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
