import type { Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';
import type { OutcomeReport } from './outcomes';
function cell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
/** Observed cohort only: no names, email addresses, phone numbers or message bodies. */
export function outcomeCsv(locale: Locale, report: OutcomeReport): string {
  const keys = ['timingCase', 'timingMessage', 'timingChannel', 'timingState', 'timingCategory', 'timingStart', 'timingReview', 'timingSeconds', 'timingFrom', 'timingThrough'];
  const rows: unknown[][] = [keys.map(key => translate(locale, `dashboard.${key}`))];
  for (const item of report.cases) rows.push([item.id, item.lastMessageId, item.channel,
    translate(locale, `dashboard.timingState_${item.state}`), item.category ? translate(locale, `dashboard.outcomeCategory_${item.category}`) : null,
    item.firstCustomerAt, item.verifiedAt, item.verificationSeconds, report.range.start, report.range.end]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
