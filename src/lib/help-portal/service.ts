import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {portalCommand,portalSnapshot,portalPublicRead,publicPortal,portalFeedback,portalStatistics,widgetPortal,type PortalSnapshot,type PublicPortal} from './contract';
const scope=z.object({workspaceId:z.string().uuid(),actorId:z.string().uuid(),agentId:z.string().uuid()}).strict();
export type PortalScope=z.infer<typeof scope>;
const failures=['portal_invalid','portal_not_found','portal_changed','portal_source_changed','portal_read_only','portal_limit','portal_unavailable'] as const;
export type PortalFailure=typeof failures[number];
export class PortalError extends Error{constructor(public readonly code:PortalFailure){super(code);}}
function failure(error:{message:string}|null){if(error)throw new PortalError(failures.includes(error.message as PortalFailure)?error.message as PortalFailure:'portal_unavailable');}
function context(raw:PortalScope){const parsed=scope.safeParse(raw);if(!parsed.success)throw new PortalError('portal_invalid');return parsed.data;}
function snapshot(raw:unknown,ctx:PortalScope):PortalSnapshot|null{
 if(raw===null)return null;const parsed=portalSnapshot.safeParse(raw);
 if(!parsed.success||parsed.data.workspace_id!==ctx.workspaceId||parsed.data.agent_id!==ctx.agentId)throw new PortalError('portal_unavailable');
 return parsed.data;
}
export async function readHelpPortal(db:SupabaseClient,raw:PortalScope){
 const ctx=context(raw);const {data,error}=await db.rpc('read_help_portal',{p_workspace_id:ctx.workspaceId,p_actor_id:ctx.actorId,p_agent_id:ctx.agentId});
 failure(error);return snapshot(data,ctx);
}
export async function manageHelpPortal(db:SupabaseClient,raw:PortalScope,command:unknown){
 const ctx=context(raw),parsed=portalCommand.safeParse(command);if(!parsed.success)throw new PortalError('portal_invalid');const value=parsed.data;
 if(value.action==='configure'&&value.input.agentId!==ctx.agentId)throw new PortalError('portal_not_found');
 // Resolve the exact portal from the selected assistant, never from browser tenant data.
 if(value.action!=='configure'){
  const current=await readHelpPortal(db,ctx);
  if(!current||current.id!==value.input.portalId)throw new PortalError('portal_not_found');
 }
 const {data,error}=await db.rpc('manage_help_portal',{p_workspace_id:ctx.workspaceId,p_actor_id:ctx.actorId,p_action:value.action,p_input:value.input});
 failure(error);const result=snapshot(data,ctx);if(!result)throw new PortalError('portal_unavailable');return result;
}
export async function loadPublicPortal(db:SupabaseClient,raw:unknown):Promise<PublicPortal|null>{
 const parsed=portalPublicRead.safeParse(raw);if(!parsed.success)throw new PortalError('portal_invalid');
 const {data,error}=await db.rpc('public_help_portal',{p_slug:parsed.data.slug,p_locale:parsed.data.locale});failure(error);
 if(data===null)return null;const result=publicPortal.safeParse(data);
 if(!result.success||result.data.slug!==parsed.data.slug||result.data.locale!==parsed.data.locale)throw new PortalError('portal_unavailable');return result.data;
}
export async function recordPortalFeedback(db:SupabaseClient,slug:string,raw:unknown){
 const event=portalFeedback.safeParse(raw);if(!event.success||!portalPublicRead.safeParse({slug,locale:event.data.locale}).success)throw new PortalError('portal_invalid');
 const value=event.data;const {data,error}=await db.rpc('record_help_portal_visit',{p_slug:slug,p_locale:value.locale,p_article_id:value.articleId,p_revision:value.revision,p_visit_id:value.visitId,p_resolved:value.resolved,p_avoided_contact:value.avoidedContact});
 failure(error);if(data!==true)throw new PortalError('portal_unavailable');
}
export async function readPortalStatistics(db:SupabaseClient,raw:PortalScope){
 const ctx=context(raw);const {data,error}=await db.rpc('help_portal_statistics',{p_workspace_id:ctx.workspaceId,p_actor_id:ctx.actorId,p_agent_id:ctx.agentId});
 failure(error);const result=portalStatistics.safeParse(data);if(!result.success)throw new PortalError('portal_unavailable');return result.data;
}
export async function purgePortalVisits(db:SupabaseClient){
 const {data,error}=await db.rpc('purge_help_portal_visits');failure(error);if(!Number.isInteger(data)||data<0||data>10000)throw new PortalError('portal_unavailable');return data as number;
}
export async function loadWidgetPortal(db:SupabaseClient,workspaceId:string,agentId:string,visitorId:string,locale:'es'|'en'){
 if(!z.string().uuid().safeParse(workspaceId).success||!z.string().uuid().safeParse(agentId).success||!z.string().min(1).max(200).safeParse(visitorId).success)throw new PortalError('portal_invalid');
 const content=await db.rpc('widget_help_portal',{p_workspace_id:workspaceId,p_agent_id:agentId,p_locale:locale});failure(content.error);
 if(content.data===null)throw new PortalError('portal_not_found');
 const orders=await db.rpc('widget_help_orders',{p_workspace_id:workspaceId,p_visitor_id:visitorId});failure(orders.error);
 const result=widgetPortal.safeParse({portal:content.data,orders:orders.data});if(!result.success||result.data.portal.locale!==locale)throw new PortalError('portal_unavailable');return result.data;
}
