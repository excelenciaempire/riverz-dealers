import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextResponse } from 'next/server';
const f=vi.hoisted(() => ({ enabled:true,locale:'es',session:vi.fn(),load:vi.fn() }));
vi.mock('@/lib/ui/improvements-preview',() => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return f.enabled; } }));
vi.mock('@/lib/inbox/server-context',() => ({ inboxSession:f.session }));
vi.mock('@/lib/i18n/server',() => ({ getLocale:async() => f.locale }));
vi.mock('@/lib/dashboard/case-reason-report',() => ({ loadCaseReasonReport:f.load }));
import { GET } from './route';
const range={ start:'2026-10-01T00:00:00Z',end:'2026-10-08T00:00:00Z',previous_start:'2026-09-24T00:00:00Z',previous_end:'2026-10-01T00:00:00Z' };
const request=(extra:Record<string,string>={}) => new Request('https://riverz.co/api/analytics/case-reasons?'+new URLSearchParams({ ...range,...extra }));
const invalidQueries:Record<string,string>[]=[{ workspace_id:'foreign' },{ start:'invalid' },{ reason:'unknown' },{ cursor:'{}' }];
beforeEach(() => { f.enabled=true;f.locale='es';f.session.mockResolvedValue({ db:'database',workspaceId:'signed-workspace',userId:'signed-user' });f.load.mockResolvedValue({ rows:[] }); });
describe('reserved case reason report API',() => {
  it('stays hidden before reading a session or querying data outside comparison',async() => {
    f.enabled=false;const response=await GET(request());expect(response.status).toBe(404);expect(f.session).not.toHaveBeenCalled();expect(f.load).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([401,403,503])('preserves authenticated context failure %s',async status => {
    f.session.mockResolvedValue({ response:NextResponse.json({ error:'session failure' },{ status }) });
    const response=await GET(request());expect(response.status).toBe(status);expect(f.load).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('uses the authenticated business and user with the exact dashboard range',async() => {
    expect((await GET(request())).status).toBe(200);expect(f.load).toHaveBeenCalledWith('database','signed-workspace','signed-user',range);
  });
  it.each(invalidQueries)('rejects invalid scope or filters before querying: %s',async extra => {
    expect((await GET(request(extra))).status).toBe(400);expect(f.load).not.toHaveBeenCalled();
  });
  it.each(['es','en'])('reports failure in %s without leaking SQL or returning empty data',async locale => {
    f.locale=locale;f.load.mockRejectedValue(new Error('private SQL detail'));const response=await GET(request());
    expect(response.status).toBe(503);const text=JSON.stringify(await response.json());expect(text).not.toMatch(/private|SQL|dashboard\.|rows/);
    expect(text).toContain(locale==='en'?'Could not load':'No se pudo');
  });
});
