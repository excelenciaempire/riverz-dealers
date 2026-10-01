import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import type { CaseReasonReport } from './case-reason-contract';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',stranger='44444444-4444-4444-8444-444444444444';
const connection='55555555-5555-4555-8555-555555555555';
const current=['2026-10-01T00:00:00Z','2026-10-08T00:00:00Z','2026-09-24T00:00:00Z','2026-10-01T00:00:00Z'];
beforeAll(async() => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid);
    CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid);
    CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,channel text DEFAULT 'whatsapp',connection_id uuid,
      case_reason text,csat integer,created_at timestamptz DEFAULT '2026-10-02T00:00:00Z',deleted_at timestamptz,is_spam boolean DEFAULT false);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
  `);
  const sql=readFileSync('supabase/migrations/328_case_reason_report.sql','utf8'); await db.exec(sql);await db.exec(sql);
},20000);
afterAll(async() => { await db.close(); });
beforeEach(async() => {
  await db.exec('RESET ROLE;TRUNCATE workspace_members,conversations,channel_connections;');
  await db.query('INSERT INTO workspace_members VALUES($1,$2)',[ws,actor]);
});
async function report(reason:string|null=null,cursor:CaseReasonReport['next_cursor']=null,workspace=ws,user=actor,dates=current) {
  const result=await db.query<{ report:CaseReasonReport }>('SELECT case_reason_report($1,$2,$3,$4,$5,$6,$7,$8,$9) AS report',[workspace,user,...dates,reason,cursor?.created_at ?? null,cursor?.id ?? null]);
  return result.rows[0].report;
}
const insert=(reason:string|null='delivery',csat:number|null=null,workspace=ws,created='2026-10-02T00:00:00Z') => db.query('INSERT INTO conversations(workspace_id,case_reason,csat,created_at) VALUES($1,$2,$3,$4)',[workspace,reason,csat,created]);
describe('complete and private case reason cohorts',() => {
  it('counts more than one thousand cases without sampling and keeps unclassified separate from other',async() => {
    await db.query("INSERT INTO conversations(workspace_id,case_reason) SELECT $1,'delivery' FROM generate_series(1,1203)",[ws]);
    await insert(null);await insert('other');
    const result=await report();
    expect(result.rows.find(row => row.reason==='delivery')?.current_count).toBe(1203);
    expect(result.rows.find(row => row.reason==='unclassified')?.current_count).toBe(1);
    expect(result.rows.find(row => row.reason==='other')?.current_count).toBe(1);
    expect(result.cases).toBeNull();expect(result.rows).toHaveLength(6);
  });
  it('uses only actual positive or negative ratings; missing and invalid ratings are not negative votes',async() => {
    await insert('delivery',1);await insert('delivery',-1);await insert('delivery');await insert('delivery',0);
    expect((await report()).rows.find(row => row.reason==='delivery')).toMatchObject({ current_count:4,rated_count:2,positive_count:1 });
  });
  it('applies start inclusively and end exclusively for current and previous periods',async() => {
    for (const date of ['2026-09-23T23:59:59.999999Z',current[2],current[0],'2026-10-07T23:59:59.999999Z',current[1]]) await insert('purchase',null,ws,date);
    expect((await report()).rows.find(row => row.reason==='purchase')).toMatchObject({ current_count:2,previous_count:1 });
  });
  it('preserves the dashboard’s distinct calendar windows across a daylight-saving boundary',async() => {
    const dates=['2026-11-01T04:00:00Z','2026-11-02T05:00:00Z','2026-10-31T04:00:00Z','2026-11-01T04:00:00Z'];
    await insert('purchase',null,ws,'2026-11-02T04:30:00Z');await insert('purchase',null,ws,'2026-10-31T04:30:00Z');
    expect((await report(null,null,ws,actor,dates)).rows.find(row => row.reason==='purchase')).toMatchObject({ current_count:1,previous_count:1 });
  });
  it('uses each window independently if the existing dashboard comparison overlaps on a long clock-change day',async() => {
    const dates=['2026-11-01T04:00:00Z','2026-11-02T04:30:00Z','2026-10-31T04:00:00Z','2026-11-01T04:30:00Z'];
    await insert('purchase',null,ws,'2026-11-01T04:15:00Z');
    expect((await report(null,null,ws,actor,dates)).rows.find(row => row.reason==='purchase')).toMatchObject({ current_count:1,previous_count:1 });
  });
  it('excludes foreign businesses, deleted cases and spam from summary and evidence',async() => {
    await insert();await insert('delivery',1,other);
    await db.query("INSERT INTO conversations(workspace_id,case_reason,deleted_at,is_spam) VALUES($1,'delivery',now(),false),($1,'delivery',NULL,true)",[ws]);
    const result=await report('delivery');
    expect(result.rows.find(row => row.reason==='delivery')?.current_count).toBe(1);expect(result.cases).toHaveLength(1);
  });
  it.each(['gmail','outlook','zoho'])('includes only the actor’s %s mailbox with matching business ownership',async channel => {
    await db.query('INSERT INTO channel_connections VALUES($1,$2,$3)',[connection,ws,actor]);
    await db.query("INSERT INTO conversations(workspace_id,case_reason,channel,connection_id) VALUES($1,'delivery',$2,$3),($1,'delivery',$2,NULL)",[ws,channel,connection]);
    expect((await report('delivery')).cases).toHaveLength(1);
    await db.query('UPDATE channel_connections SET created_by=$1',[stranger]);expect((await report('delivery')).cases).toHaveLength(0);
    await db.query('UPDATE channel_connections SET created_by=$1,workspace_id=$2',[actor,other]);expect((await report('delivery')).cases).toHaveLength(0);
  });
  it('requires current membership for both counts and evidence',async() => {
    await insert();await expect(report(null,null,other)).rejects.toThrow('invalid_case_reason_context');
    await expect(report(null,null,ws,stranger)).rejects.toThrow('invalid_case_reason_context');
    await db.exec('DELETE FROM workspace_members');await expect(report('delivery')).rejects.toThrow('invalid_case_reason_context');
  });
  it('paginates forty-three cases sharing a microsecond timestamp without losing or repeating ids',async() => {
    await db.query("INSERT INTO conversations(workspace_id,case_reason,created_at) SELECT $1,'return','2026-10-02T00:00:00.123456Z' FROM generate_series(1,43)",[ws]);
    const ids:string[]=[];let cursor:CaseReasonReport['next_cursor']=null;
    do { const result=await report('return',cursor);ids.push(...result.cases!.map(row => row.id));cursor=result.next_cursor;if(cursor) expect(cursor.created_at).toContain('.123456'); } while(cursor);
    expect(ids).toHaveLength(43);expect(new Set(ids).size).toBe(43);
  });
  it.each([
    ['2026-10-08T00:00:00Z','2026-10-01T00:00:00Z',...current.slice(2)],
    ['2026-01-01T00:00:00Z','2026-10-08T00:00:00Z',...current.slice(2)],
    [current[0],current[1],current[2],'2026-10-09T00:00:00Z'],
  ])('rejects invalid or unbounded ranges %s',async(...dates) => {
    await expect(report(null,null,ws,actor,dates)).rejects.toThrow('invalid_case_reason_range');
  });
  it('rejects unsupported reasons and a cursor without a selected reason',async() => {
    await expect(report('invented')).rejects.toThrow('invalid_case_reason_range');
    await expect(report(null,{ id:actor,created_at:current[0] })).rejects.toThrow('invalid_case_reason_range');
  });
  it('gives only the service role access to the read-only RPC',async() => {
    const signature='case_reason_report(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz,uuid)';
    for(const role of ['anon','authenticated','service_role']) {
      expect((await db.query<{ allowed:boolean }>('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,signature,'execute'])).rows[0].allowed).toBe(role==='service_role');
    }
    await insert();await db.exec('SET ROLE service_role');expect((await report('delivery')).cases).toHaveLength(1);
  });
});
