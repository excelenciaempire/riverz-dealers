'use client'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import type { InboxAction, InboxActionResult } from '@/lib/inbox/case-actions'

export interface ActionLabels { tags: Record<string, string>; teams: Record<string, string>; members: Record<string, string> }
export function ActionPreview({ actions, labels }: { actions: (InboxAction | InboxActionResult)[]; labels?: ActionLabels }) {
  const t = useT()
  const fmt = useFormat()
  return <ol className="space-y-2 text-xs">{actions.map((action, i) => <li key={i} className="rounded border p-2">
    <p className="font-medium">{i + 1}. {t(`inbox.action_${action.type}`)}</p>
    {'body' in action && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{action.body}</p>}
    {'minutes' in action && <p className="mt-1 text-muted-foreground">{t('inbox.actionAfterMinutes', { minutes: action.minutes })}</p>}
    {'until' in action && action.until && <p className="mt-1 text-muted-foreground">{fmt.dateTime(action.until)}</p>}
    {'due_at' in action && action.due_at && <p className="mt-1 text-muted-foreground">{fmt.dateTime(action.due_at)}</p>}
    {action.type === 'case' && <p className="mt-1 text-muted-foreground">{t(`inbox.casePriority_${action.priority}`)} · {action.reason ? t(`inbox.caseReason_${action.reason}`) : t('inbox.caseUnclassified')}</p>}
    {'tag_id' in action && action.tag_id && <p className="mt-1 text-muted-foreground">{labels?.tags[action.tag_id] ?? t('inbox.actionTargetUnknown')}</p>}
    {'team_id' in action && action.team_id && <p className="mt-1 text-muted-foreground">{labels?.teams[action.team_id] ?? t('inbox.actionTargetUnknown')}</p>}
    {'agent_ids' in action && action.agent_ids && <p className="mt-1 text-muted-foreground">{action.agent_ids.map(id => labels?.members[id] ?? t('inbox.actionTargetUnknown')).join(', ')}</p>}
    {'agent_id' in action && action.agent_id && <p className="mt-1 text-muted-foreground">{labels?.members[action.agent_id] ?? t('inbox.teamMember')}</p>}
    {action.type === 'tag' && <p className="mt-1 text-muted-foreground">{t('inbox.tagMayTrigger')}</p>}
  </li>)}</ol>
}
