import {z} from 'zod';
export const PORTAL_MAX_ARTICLES=30,PORTAL_MAX_BODY=16000,PORTAL_MAX_BODY_BYTES=48000;
const id=z.string().uuid(),revision=z.number().int().min(1).max(2147483647),locale=z.enum(['es','en']);
const text=(max:number)=>z.string().trim().max(max).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
export const portalSlug=z.string().min(3).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const portalBrand=z.object({name:text(120).min(1),description:text(300),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/)}).strict();
export const portalConfiguration=z.object({id,agentId:id,slug:portalSlug,brand:portalBrand,revision:z.number().int().min(0).max(2147483647),published:z.boolean()}).strict();
export const portalArticleInput=z.object({id,portalId:id,sourceId:id,sourceRevision:revision,title:text(160).min(1),body:text(PORTAL_MAX_BODY).min(1),locale,
 revision:z.number().int().min(0).max(2147483647)}).strict().refine(value=>new TextEncoder().encode(value.body).length<=PORTAL_MAX_BODY_BYTES);
export const portalArticleAction=z.object({id,portalId:id,revision,action:z.enum(['publish','withdraw'])}).strict();
export const portalArticle=z.object({id,portal_id:id,source_id:id,source_revision:revision,title:z.string().min(1).max(160),body:z.string().min(1).max(PORTAL_MAX_BODY),locale,
 revision,status:z.enum(['draft','published','withdrawn']),updated_at:z.string().datetime({offset:true})}).strict();
export const portalSnapshot=z.object({id,workspace_id:id,agent_id:id,slug:portalSlug,brand:portalBrand,revision,published:z.boolean(),articles:z.array(portalArticle).max(PORTAL_MAX_ARTICLES)}).strict()
 .refine(value=>new Set(value.articles.map(article=>article.id)).size===value.articles.length&&value.articles.every(article=>article.portal_id===value.id));
export const publicPortal=z.object({slug:portalSlug,brand:portalBrand,locale,articles:z.array(z.object({id,title:z.string().min(1).max(160),revision,body:z.string().min(1).max(PORTAL_MAX_BODY),updated_at:z.string().datetime({offset:true})}).strict()).max(PORTAL_MAX_ARTICLES)}).strict();
export const portalRead=z.object({id}).strict();
export const portalPublicRead=z.object({slug:portalSlug,locale}).strict();
export const portalFeedback=z.object({articleId:id,revision,visitId:id,locale,resolved:z.boolean().nullable(),avoidedContact:z.boolean().nullable().default(null)}).strict()
 .refine(value=>value.avoidedContact===null||value.resolved===true);
export const portalOrder=z.object({id,reference:text(80).min(1),status:z.enum(['unknown','created','paid','fulfilled','refunded','cancelled','failed']),observed_at:z.string().datetime({offset:true})}).strict();
export const widgetPortal=z.object({portal:publicPortal,orders:z.array(portalOrder).max(20)}).strict();
export const portalStatistics=z.object({views:z.number().int().nonnegative(),responded:z.number().int().nonnegative(),resolved:z.number().int().nonnegative(),needsHelp:z.number().int().nonnegative(),avoidanceResponded:z.number().int().nonnegative(),reportedAvoided:z.number().int().nonnegative(),windowDays:z.literal(30),observedAt:z.string().datetime({offset:true})}).strict()
 .refine(value=>value.responded===value.resolved+value.needsHelp&&value.responded<=value.views&&value.reportedAvoided<=value.avoidanceResponded&&value.avoidanceResponded<=value.resolved);
export const portalCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('configure'),input:portalConfiguration}).strict(),
 z.object({action:z.literal('save'),input:portalArticleInput}).strict(),
 z.object({action:z.literal('publish'),input:portalArticleAction.extend({action:z.literal('publish'),reviewed:z.literal(true)})}).strict(),
 z.object({action:z.literal('withdraw'),input:portalArticleAction.extend({action:z.literal('withdraw')})}).strict(),
]);
export type PortalSnapshot=z.infer<typeof portalSnapshot>;
export type PublicPortal=z.infer<typeof publicPortal>;
