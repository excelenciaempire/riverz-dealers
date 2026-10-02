import {z} from 'zod';
import {translate} from '@/lib/i18n/translate';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {gapCapabilityActor} from '@/lib/ai/gap-knowledge-actions';
import {productPolicyWrite} from '@/lib/returns/product-policy-contract';
import {readProductReturnPolicy,writeProductReturnPolicy,ProductPolicyError} from '@/lib/returns/product-policy';
import type {Capability,CapabilityContext} from './types';
import {cambio} from './vistas';
const read=z.object({product_id:z.string().uuid()}).strict(),write=z.object({product_id:z.string().uuid(),change:productPolicyWrite}).strict();
const id={type:'string',format:'uuid'};
const t=(ctx:CapabilityContext,key:string)=>translate(ctx.locale??'es',`products.${key}`);
function actor(ctx:CapabilityContext){
 if(!SHOW_RIVERZ_IMPROVEMENTS)throw Error(t(ctx,'returnPolicyNotFound'));
 try{const who=gapCapabilityActor(ctx);if(!z.string().uuid().safeParse(who).success)throw Error('invalid');return who;}catch{throw Error(t(ctx,'returnPolicyUnauthorized'));}
}
function failed(ctx:CapabilityContext,error:unknown):never{
 const code=error instanceof ProductPolicyError?error.code:'unavailable';
 throw Error(t(ctx,{invalid:'returnPolicyInvalid',notFound:'returnPolicyNotFound',changed:'returnPolicyChanged',readOnly:'returnPolicyReadOnly',unavailable:'returnPolicyUnavailable'}[code]));
}
export const PRODUCT_RETURN_POLICY_CAPABILITIES:Capability[]=[
 {
  key:'productos.politica_devolucion',risk:'lectura',
  description:'Consulta la política específica y versión actual de cambios/devoluciones de un producto exacto y autorizado. policy=null conserva la política general; datos ausentes no significan plazo ilimitado. No evalúa fechas ni autoriza rechazo, dinero o reposiciones.',
  descriptionEn:'Reads the current product-specific return/exchange policy and version for an exact authorized product. A null policy preserves general terms; missing data is not an unlimited window. Does not evaluate dates or authorize denial, money or replacements.',
  schema:{type:'object',properties:{product_id:id},required:['product_id']},
  async run(ctx,args){const who=actor(ctx),input=read.safeParse(args);if(!input.success)throw Error(t(ctx,'returnPolicyInvalid'));
   try{return await readProductReturnPolicy(ctx.db,ctx.workspaceId,who,input.data.product_id);}catch(error){failed(ctx,error);}
  },
 },
 {
  key:'productos.definir_politica_devolucion',risk:'irreversible',
  description:'Tras revisión humana de un administrador guarda o retira (policy=null) condiciones específicas de cambios/devoluciones de un producto, mediante el mismo escritor que el editor. Nunca inventes condiciones, plazos o soluciones que el dueño no pidió. Consulta la versión actual, conserva expected_revision y reutiliza change.id al reintentar. No modifica dinero ni pedidos.',
  descriptionEn:'After an administrator’s human review, saves or withdraws (policy=null) product-specific return terms through the same writer as the editor. Never invent owner terms, windows or remedies. Read the current version, preserve expected_revision and reuse change.id on retry. Does not change money or orders.',
  schema:{type:'object',properties:{product_id:id,change:{type:'object',additionalProperties:false,properties:{id,expected_revision:{type:'integer',minimum:0,maximum:2147483646},policy:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{mode:{enum:['allow','review','not_offered']},window_days:{type:['integer','null'],minimum:1,maximum:365},starts_at:{enum:['purchase','delivery']},remedies:{type:'array',maxItems:4,uniqueItems:true,items:{enum:['refund','replacement','exchange','store_credit']}},conditions:{type:'string',maxLength:1200}},required:['mode','window_days','starts_at','remedies','conditions']}]}},required:['id','expected_revision','policy']}},required:['product_id','change']},
  async preview(ctx,args){const who=actor(ctx),input=write.safeParse(args);if(!input.success)throw Error(t(ctx,'returnPolicyInvalid'));
   try{const current=await readProductReturnPolicy(ctx.db,ctx.workspaceId,who,input.data.product_id);if(!current.can_edit)throw new ProductPolicyError('notFound');if(current.snapshot.revision!==input.data.change.expected_revision)throw new ProductPolicyError('changed');}catch(error){failed(ctx,error);}
   return t(ctx,'returnPolicyScope');
  },
  async run(ctx,args){const who=actor(ctx),input=write.safeParse(args);if(!input.success)throw Error(t(ctx,'returnPolicyInvalid'));
   try{return await writeProductReturnPolicy(ctx.db,ctx.workspaceId,who,input.data.product_id,input.data.change);}catch(error){failed(ctx,error);}
  },
  artifact(ctx,args){const input=write.safeParse(args),policy=input.success?input.data.change.policy:null;
   return cambio({titulo:t(ctx,'returnPolicyTitle'),que:t(ctx,policy?'returnPolicyTitle':'returnPolicyWithdraw'),aviso:t(ctx,'returnPolicyScope'),campos:policy?
    [{etiqueta:t(ctx,'returnPolicyMode'),despues:t(ctx,`returnPolicyMode_${policy.mode}`)},{etiqueta:t(ctx,'returnPolicyDays'),despues:policy.window_days===null?t(ctx,'returnPolicyUnspecified'):String(policy.window_days)},
     {etiqueta:t(ctx,'returnPolicyStarts'),despues:t(ctx,`returnPolicyStarts_${policy.starts_at}`)},{etiqueta:t(ctx,'returnPolicyRemedies'),despues:policy.remedies.map(value=>t(ctx,`returnPolicyRemedy_${value}`)).join(', ')},
     {etiqueta:t(ctx,'returnPolicyConditions'),despues:policy.conditions}]:[]});
  },
 },
];
