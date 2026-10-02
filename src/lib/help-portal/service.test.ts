import {describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadPublicPortal,readHelpPortal,manageHelpPortal,loadWidgetPortal,recordPortalFeedback,readPortalStatistics} from './service';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444';
const ctx={workspaceId:ws,actorId:actor,agentId:agent},brand={name:'Fixture',description:'Help',accent:'#123456'},snapshot={id,workspace_id:ws,agent_id:agent,slug:'fixture-shop',brand,revision:1,published:false,articles:[]};
function database(data:unknown=snapshot,error:{message:string}|null=null){const rpc=vi.fn().mockResolvedValue({data,error});return {db:{rpc} as unknown as SupabaseClient,rpc};}
describe('Help portal server projection and context',()=>{
 it('binds widget reads to guarded visitor/assistant and refuses private fields in a returned order',async()=>{
  const f=database();const portal={slug:'fixture-shop',brand,locale:'en',articles:[]};
  f.rpc.mockResolvedValueOnce({data:portal,error:null}).mockResolvedValueOnce({data:[{id,reference:'#1',status:'paid',observed_at:'2026-10-02T00:00:00Z',customer_email:'private'}],error:null});
  await expect(loadWidgetPortal(f.db,ws,agent,'signed-visitor','en')).rejects.toThrow('portal_unavailable');
  expect(f.rpc).toHaveBeenNthCalledWith(1,'widget_help_portal',{p_workspace_id:ws,p_agent_id:agent,p_locale:'en'});
  expect(f.rpc).toHaveBeenNthCalledWith(2,'widget_help_orders',{p_workspace_id:ws,p_visitor_id:'signed-visitor'});
 });
 it('rejects forged feedback scope and inconsistent self-reported metric denominators',async()=>{
  const f=database();await expect(recordPortalFeedback(f.db,'fixture-shop',{articleId:id,revision:1,visitId:actor,locale:'en',resolved:true,workspace_id:ws})).rejects.toThrow('portal_invalid');expect(f.rpc).not.toHaveBeenCalled();
  const stats=database({views:1,responded:2,resolved:2,needsHelp:0,windowDays:30,observedAt:'2026-10-02T00:00:00Z'});
  await expect(readPortalStatistics(stats.db,ctx)).rejects.toThrow('portal_unavailable');
 });
 it('passes current server identity to private RPCs without accepting browser scope',async()=>{
  const f=database();expect(await readHelpPortal(f.db,ctx)).toEqual(snapshot);
  expect(f.rpc).toHaveBeenCalledWith('read_help_portal',{p_workspace_id:ws,p_actor_id:actor,p_agent_id:agent});
  await expect(manageHelpPortal(f.db,ctx,{action:'configure',input:{id,agentId:agent,slug:'fixture-shop',brand,revision:0,published:false,actorId:actor}})).rejects.toThrow('portal_invalid');
  expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it('rejects a returned foreign assistant or business instead of exposing it',async()=>{
  for(const patch of [{workspace_id:actor},{agent_id:actor},{unexpected:'private'}])await expect(readHelpPortal(database({...snapshot,...patch}).db,ctx)).rejects.toThrow('portal_unavailable');
 });
 it('binds article commands to the exact selected assistant portal before mutation',async()=>{
  const f=database();await expect(manageHelpPortal(f.db,ctx,{action:'withdraw',input:{id:actor,portalId:actor,revision:1,action:'withdraw'}})).rejects.toThrow('portal_not_found');
  expect(f.rpc).toHaveBeenCalledTimes(1);
  await expect(manageHelpPortal(f.db,ctx,{action:'configure',input:{id,agentId:actor,slug:'fixture-shop',brand,revision:0,published:false}})).rejects.toThrow('portal_not_found');
 });
 it('requires literal review and rejects unsafe command data before any database call',async()=>{
  const f=database();await expect(manageHelpPortal(f.db,ctx,{action:'publish',input:{id:actor,portalId:id,revision:1,action:'publish',reviewed:false}})).rejects.toThrow('portal_invalid');
  expect(f.rpc).not.toHaveBeenCalled();
 });
 it('accepts missing unpublished portals but never treats database failures as empty',async()=>{
  expect(await readHelpPortal(database(null).db,ctx)).toBeNull();
  await expect(readHelpPortal(database(null,{message:'private SQL detail'}).db,ctx)).rejects.toThrow('portal_unavailable');
  await expect(readHelpPortal(database(null,{message:'portal_read_only'}).db,ctx)).rejects.toThrow('portal_read_only');
 });
 it('exposes only a strict public response for the exact requested slug and language',async()=>{
  const response={slug:'fixture-shop',brand,locale:'en',articles:[]};expect(await loadPublicPortal(database(response).db,{slug:'fixture-shop',locale:'en'})).toEqual(response);
  for(const patch of [{workspace_id:ws},{slug:'foreign-store'},{locale:'es'}])await expect(loadPublicPortal(database({...response,...patch}).db,{slug:'fixture-shop',locale:'en'})).rejects.toThrow('portal_unavailable');
  const f=database();await expect(loadPublicPortal(f.db,{slug:'../private',locale:'en'})).rejects.toThrow('portal_invalid');expect(f.rpc).not.toHaveBeenCalled();
 });
});
