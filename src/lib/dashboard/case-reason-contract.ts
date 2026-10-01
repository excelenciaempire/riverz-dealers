import { z } from 'zod';
import { CASE_REASONS } from '@/lib/inbox/collaboration';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
export const reportedReason = z.enum([...CASE_REASONS, 'unclassified']);
const date = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const count = z.number().int().nonnegative().safe();
export const caseReasonCursor = z.object({ id: z.string().uuid(), created_at: date }).strict();
const range = z.object({ start: date, end: date, previous_start: date, previous_end: date });
const validRange = (value: z.infer<typeof range>) => {
  const start = Date.parse(value.start), end = Date.parse(value.end), before = Date.parse(value.previous_start), until = Date.parse(value.previous_end);
  return start < end && before < until && before < start && until <= end && end-start <= 180*86_400_000 && until-before <= 180*86_400_000;
};
export const caseReasonQuery = range.extend({ reason: reportedReason.optional(), cursor: z.string().min(1).max(512).optional() }).strict().refine(validRange).refine(value => !value.cursor || !!value.reason);
export function parseCaseReasonQuery(params: URLSearchParams) {
  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('case_reason_invalid');
  const value = caseReasonQuery.parse(Object.fromEntries(entries));
  if (value.cursor) caseReasonCursor.parse(JSON.parse(value.cursor));
  return value;
}
export const caseReasonEvidence = z.object({ id: z.string().uuid(), channel: z.string().min(1), created_at: date, reason: reportedReason, csat: z.union([z.literal(-1),z.literal(1)]).nullable() }).strict();
const row = z.object({ reason: reportedReason, current_count: count, previous_count: count, rated_count: count, positive_count: count }).strict().refine(value => value.positive_count <= value.rated_count && value.rated_count <= value.current_count);
export const caseReasonReport = range.extend({ observed_at: date, rows: z.array(row).length(6), selected_reason: reportedReason.nullable(), cases: z.array(caseReasonEvidence).max(20).nullable(), next_cursor: caseReasonCursor.nullable() }).strict().refine(validRange).refine(value => new Set(value.rows.map(row => row.reason)).size === 6 && (value.selected_reason ? value.cases !== null && value.cases.every(row => row.reason === value.selected_reason) : value.cases === null && value.next_cursor === null));
export type CaseReasonQuery = z.infer<typeof caseReasonQuery>;
export type CaseReasonReport = z.infer<typeof caseReasonReport>;
export type CaseReasonEvidence = z.infer<typeof caseReasonEvidence>;
/** Export the exact validated observation on screen; no names or message bodies. */
export function caseReasonCsv(locale: Locale, report: CaseReasonReport): string {
  const data = caseReasonReport.parse(report);
  const cell = (value: string | number) => `"${String(value).replace(/"/g,'""')}"`;
  const keys = ['reasonColumn','currentCases','previousCases','ratedCases','positiveCases','periodStart','periodEnd','previousStart','previousEnd','observedAt'];
  const rows: Array<Array<string | number>> = [keys.map(key => translate(locale, `dashboard.caseReasons_${key}`)), ...data.rows.map(row => [translate(locale,row.reason === 'unclassified' ? 'inbox.caseUnclassified' : `inbox.caseReason_${row.reason}`),row.current_count,row.previous_count,row.rated_count,row.positive_count,data.start,data.end,data.previous_start,data.previous_end,data.observed_at])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
