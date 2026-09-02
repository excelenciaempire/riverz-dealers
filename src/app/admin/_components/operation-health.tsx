'use client';

import { useT } from '@/hooks/use-locale';
import { useAdminData, Muted } from './admin-ui';

interface OperationHealthData {
  profile: { configured: boolean; promptVersion: string | null };
  validation: { status: 'passed' | 'warning' | 'blocked' } | null;
  last24h: { sent: number; failed: number; handoffs: number };
}

export function OperationHealth({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { data } = useAdminData<OperationHealthData>(
    `/api/admin/workspaces/${workspaceId}/operation-health`,
  );
  if (!data) return <Muted>{t('admin.loading')}</Muted>;
  const validation = !data.validation
    ? t('admin.operationHealthNoValidation')
    : data.validation.status === 'passed'
      ? t('admin.operationHealthPassed')
      : data.validation.status === 'warning'
        ? t('admin.operationHealthWarning')
        : t('admin.operationHealthBlocked');
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
      <Metric
        label={t('admin.operationHealthProfile')}
        value={data.profile.configured ? data.profile.promptVersion ?? 'v1' : t('admin.operationHealthNoProfile')}
      />
      <Metric label={t('admin.operationHealthValidation')} value={validation} />
      <Metric
        label={t('admin.operationHealthReplies')}
        value={`${data.last24h.sent}${data.last24h.failed ? ` / ${data.last24h.failed}` : ''}`}
      />
      <Metric label={t('admin.operationHealthHandoffs')} value={String(data.last24h.handoffs)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
