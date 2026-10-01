import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {httpRunQuery,loadHttpRunHistory} from './http-action-run-history';
import {httpRunHistory,httpRunHistoryCsv} from './http-action-run-history-contract';
const id='11111111-1111-4111-8111-111111111111',at='2026-10-01T12:30:00.123456+00:00';
const row={id,action_revision:2,state:'uncertain',status_code:null,error_code:'http_timeout',created_at:at,finished_at:at};
const payload=()=>({runs:[row],next_cursor:{created_at:at,id},observed_at:at});
describe('Bounded private HTTP receipt contract',()=>{
 it('preserves cursor microseconds without transforming them into a Date',()=>{
  const cursor={created_at:at,id};expect(httpRunQuery(new URLSearchParams({cursor:JSON.stringify(cursor)}))).toEqual(cursor);
  expect(httpRunQuery(new URLSearchParams())).toBeNull();
 });
 it.each(['cursor=','cursor=bad','cursor={}&cursor={}','actor_id=other','cursor='+encodeURIComponent(JSON.stringify({created_at:at,id,workspace_id:id}))])('rejects scope overrides and malformed query %s',query=>{
  expect(()=>httpRunQuery(new URLSearchParams(query))).toThrow('http_action_invalid');
 });
 it('accepts only the fixed metadata contract, not results, inputs or credentials',()=>{
  expect(httpRunHistory.parse(payload()).runs).toHaveLength(1);
  for(const extra of [{result:{secret:'private'}},{input_hash:'private'},{credential:'private'}])expect(httpRunHistory.safeParse({...payload(),runs:[{...row,...extra}]}).success).toBe(false);
  expect(httpRunHistory.safeParse({...payload(),runs:Array(21).fill(row)}).success).toBe(false);
  expect(httpRunHistory.safeParse({...payload(),runs:[{...row,error_code:'RAW_PRIVATE_ERROR'}]}).success).toBe(false);
 });
 it('passes the actual actor and workspace to one read RPC with the raw cursor',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:payload(),error:null}),cursor={created_at:at,id};
  expect(await loadHttpRunHistory({rpc} as unknown as SupabaseClient,'current-workspace','session-actor',id,cursor)).toEqual(payload());
  expect(rpc).toHaveBeenCalledExactlyOnceWith('read_http_action_runs',{p_workspace_id:'current-workspace',p_actor_id:'session-actor',p_action_id:id,p_cursor_at:at,p_cursor_id:id});
 });
 it.each([['http_action_admin_required','forbidden'],['invalid_http_action_context','not_found'],['RAW_PRIVATE_ERROR','unavailable']])('maps private database error %s',async(message,code)=>{
  const rpc=vi.fn().mockResolvedValue({error:{message},data:null});await expect(loadHttpRunHistory({rpc} as unknown as SupabaseClient,'ws','actor',id,null)).rejects.toThrow('http_action_'+code);
 });
 it.each(['es','en'] as const)('exports only validated loaded metadata in %s',locale=>{
  const rows=httpRunHistory.parse(payload()).runs,csv=httpRunHistoryCsv(locale,rows);
  expect(csv.charCodeAt(0)).toBe(0xfeff);expect(csv).toContain('"uncertain"');expect(csv).toContain(at);expect(csv).not.toMatch(/input|credential|result/);
 });
});
