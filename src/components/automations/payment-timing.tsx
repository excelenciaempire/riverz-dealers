'use client';
import { Input } from '@/components/ui/input';
import { useT } from '@/hooks/use-locale';

export function paymentWaitConfig(hours: number) {
  const value = Number.isFinite(hours) ? Math.max(1, hours) : 1;
  return { amount: value, unit: 'hours', from_trigger_hours: value };
}

/** Payment recipes expose the absolute clock the engine actually uses. */
export function PaymentTimingField({
  config,
  onChange,
  deadline = false,
}: {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  deadline?: boolean;
}) {
  const t = useT();
  const key = deadline ? 'expires_after_hours' : 'from_trigger_hours';
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs font-medium">
        {t(
          deadline
            ? 'automations.paymentReminderDeadline'
            : 'automations.paymentReminderHour'
        )}
      </span>
      <Input
        type="number"
        min={1}
        step={1}
        value={typeof config[key] === 'number' ? (config[key] as number) : ''}
        placeholder={deadline ? t('automations.paymentNoDeadline') : undefined}
        onChange={(e) =>
          onChange(
            deadline
              ? {
                  expires_after_hours: e.target.value
                    ? Math.max(1, Number(e.target.value))
                    : undefined,
                }
              : paymentWaitConfig(Number(e.target.value))
          )
        }
        className="bg-muted text-foreground"
      />
    </label>
  );
}
