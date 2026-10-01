import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCaseReasonReport } from './case-reason-report';
import { caseReasonCsv,caseReasonReport,parseCaseReasonQuery,reportedReason,type CaseReasonReport } from './case-reason-contract';
import { translate } from '@/lib/i18n/translate';
import { rangeForPreset,previousRangeForPreset } from './date-utils';
const range={ start:'2026-10-01T00:00:00Z',end:'2026-10-08T00:00:00Z',previous_start:'2026-09-24T00:00:00Z',previous_end:'2026-10-01T00:00:00Z' };
const rpc=vi.fn();const db={ rpc } as unknown as SupabaseClient;
function report():CaseReasonReport {
  return { ...range,observed_at:'2026-10-09T00:00:00Z',rows:reportedReason.options.map(reason => ({ reason,current_count:0,previous_count:0,rated_count:0,positive_count:0 })),selected_reason:null,cases:null,next_cursor:null };
}
beforeEach(() => { rpc.mockResolvedValue({ data:report(),error:null }); });
describe('case reason report contract and trusted loader',() => {
  it('passes only its trusted business and actor, with the dashboard windows unchanged',async() => {
    expect(await loadCaseReasonReport(db,'trusted-business','trusted-user',range)).toEqual(report());
    expect(rpc).toHaveBeenCalledWith('case_reason_report',{ p_workspace_id:'trusted-business',p_actor_id:'trusted-user',p_start:range.start,p_end:range.end,p_previous_start:range.previous_start,p_previous_end:range.previous_end,p_reason:null,p_cursor_at:null,p_cursor_id:null });
  });
  it('keeps a microsecond cursor intact and checks the selected reason in the response',async() => {
    const cursor={ id:'11111111-1111-4111-8111-111111111111',created_at:'2026-10-02T00:00:00.123456Z' };
    const data={ ...report(),selected_reason:'delivery',cases:[] };rpc.mockResolvedValue({ data,error:null });
    await loadCaseReasonReport(db,'trusted-business','trusted-user',{ ...range,reason:'delivery',cursor:JSON.stringify(cursor) });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_reason:'delivery',p_cursor_at:cursor.created_at,p_cursor_id:cursor.id });
    await expect(loadCaseReasonReport(db,'trusted-business','trusted-user',range)).rejects.toThrow('case_reason_unavailable');
  });
  it('does not present a database failure or malformed response as zero cases',async() => {
    rpc.mockResolvedValueOnce({ data:null,error:{ message:'private SQL' } });await expect(loadCaseReasonReport(db,'w','u',range)).rejects.toThrow('case_reason_unavailable');
    rpc.mockResolvedValueOnce({ data:{ ...report(),rows:[] },error:null });await expect(loadCaseReasonReport(db,'w','u',range)).rejects.toThrow();
  });
  it('rejects a response from a different observation window',async() => {
    rpc.mockResolvedValue({ data:{ ...report(),start:'2026-10-02T00:00:00Z' },error:null });
    await expect(loadCaseReasonReport(db,'w','u',range)).rejects.toThrow('case_reason_unavailable');
  });
  it.each(['workspace_id=foreign','actor_id=foreign','reason=unknown','reason=delivery&reason=return','cursor=','cursor=invalid','start=invalid'])('rejects malformed query %s',query => {
    const params=new URLSearchParams(range);for(const [key,value] of new URLSearchParams(query)) params.append(key,value);
    expect(() => parseCaseReasonQuery(params)).toThrow();
  });
  it('requires a reason with a cursor and rejects unsafe or extra cursor fields',() => {
    const cursor=JSON.stringify({ id:'11111111-1111-4111-8111-111111111111',created_at:'2026-10-02T00:00:00Z',workspace_id:'foreign' });
    expect(() => parseCaseReasonQuery(new URLSearchParams({ ...range,cursor }))).toThrow();
    expect(() => parseCaseReasonQuery(new URLSearchParams({ ...range,reason:'delivery',cursor }))).toThrow();
  });
  it('rejects reversed windows, a later comparison and windows over 180 days',() => {
    for(const invalid of [{ start:range.end,end:range.start },{ previous_end:'2026-10-09T00:00:00Z' },{ start:'2026-01-01T00:00:00Z',previous_end:'2026-01-01T00:00:00Z',previous_start:'2025-12-01T00:00:00Z' }]) {
      expect(() => parseCaseReasonQuery(new URLSearchParams({ ...range,...invalid }))).toThrow();
    }
  });
  it('accepts the current dashboard’s late-day comparison during a 25-hour day',() => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T04:30:00Z'));
    try {
      const current=rangeForPreset('America/New_York','today'),previous=previousRangeForPreset('America/New_York','today',current);
      const query={ start:current.start.toISOString(),end:current.end.toISOString(),previous_start:previous.start.toISOString(),previous_end:previous.end.toISOString() };
      expect(Date.parse(query.previous_end)).toBeGreaterThan(Date.parse(query.start));
      expect(parseCaseReasonQuery(new URLSearchParams(query))).toEqual(query);
    } finally { vi.useRealTimers(); }
  });
  it('requires exactly one row for each reason and consistent rating denominators',() => {
    const data=report();data.rows[0]={ ...data.rows[0],positive_count:1,rated_count:0,current_count:1 };expect(caseReasonReport.safeParse(data).success).toBe(false);
    data.rows[0]={ ...data.rows[1] };expect(caseReasonReport.safeParse(data).success).toBe(false);
  });
  it('rejects evidence belonging to a different selected reason or unknown ratings',() => {
    const data={ ...report(),selected_reason:'delivery',cases:[{ id:'11111111-1111-4111-8111-111111111111',channel:'whatsapp',created_at:range.start,reason:'return',csat:0 }] };
    expect(caseReasonReport.safeParse(data).success).toBe(false);
  });
  it.each(['es','en'] as const)('exports the exact observed counts, dates and rating denominator in %s with UTF-8 and both labels',locale => {
    const data=report();data.rows[0]={ ...data.rows[0],current_count:1203,previous_count:10,rated_count:2,positive_count:1 };
    const csv=caseReasonCsv(locale,data);
    expect(csv.startsWith('\uFEFF')).toBe(true);expect(csv).toContain('"1203","10","2","1"');
    expect(csv).toContain(translate(locale,'inbox.caseReason_purchase'));expect(csv).toContain(translate(locale,'inbox.caseUnclassified'));
    expect(csv).toContain(range.previous_start);expect(csv).toContain(data.observed_at);
    expect(csv).not.toMatch(/dashboard\.|inbox\.|undefined|NaN/);expect(csv.split('\r\n')).toHaveLength(8);
  });
});
