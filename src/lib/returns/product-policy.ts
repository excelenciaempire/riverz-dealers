import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {productPolicySnapshot,productPolicyWrite,type ProductPolicySnapshot} from './product-policy-contract';

export class ProductPolicyError extends Error{constructor(readonly code:'invalid'|'notFound'|'changed'|'readOnly'|'unavailable'){super(code);}}
function identity(...ids:string[]){if(!ids.every(id=>z.string().uuid().safeParse(id).success))throw new ProductPolicyError('invalid');}
function failure(message:string):never{
 const codes:Record<string,ProductPolicyError['code']>={invalid_product_return_policy:'invalid',product_return_policy_not_found:'notFound',product_return_policy_changed:'changed',product_return_policy_read_only:'readOnly'};
 throw new ProductPolicyError(codes[message]??'unavailable');
}
export async function readProductReturnPolicy(db:SupabaseClient,workspaceId:string,actorId:string,productId:string){
 identity(workspaceId,actorId,productId);const result=await db.rpc('read_product_return_policy',{p_workspace_id:workspaceId,p_actor_id:actorId,p_product_id:productId});
 if(result.error)failure(result.error.message);const parsed=z.object({snapshot:productPolicySnapshot,can_edit:z.boolean()}).strict().safeParse(result.data);
 if(!parsed.success||parsed.data.snapshot.product_id!==productId)throw new ProductPolicyError('unavailable');return parsed.data;
}
export async function writeProductReturnPolicy(db:SupabaseClient,workspaceId:string,actorId:string,productId:string,input:z.infer<typeof productPolicyWrite>){
 identity(workspaceId,actorId,productId);const parsed=productPolicyWrite.safeParse(input);if(!parsed.success)throw new ProductPolicyError('invalid');
 const value=parsed.data;const result=await db.rpc('write_product_return_policy',{p_workspace_id:workspaceId,p_actor_id:actorId,p_product_id:productId,p_id:value.id,p_expected_revision:value.expected_revision,p_policy:value.policy});
 if(result.error)failure(result.error.message);const output=productPolicySnapshot.safeParse(result.data);
 if(!output.success||output.data.product_id!==productId||output.data.revision!==value.expected_revision+1||JSON.stringify(output.data.policy)!==JSON.stringify(value.policy))throw new ProductPolicyError('unavailable');
 return output.data;
}

export type ProductPolicyContext={return_policy?:ProductPolicySnapshot;return_policy_unavailable?:boolean};
/** Only decorate products already admitted to this assistant's current catalog.
 * An unavailable read is not a declaration that no product policy exists. */
export async function attachProductReturnPolicies<T extends {id?:string}&ProductPolicyContext>(db:SupabaseClient,workspaceId:string,agentId:string,products:T[]):Promise<Array<T&ProductPolicyContext>>{
 if(!SHOW_RIVERZ_IMPROVEMENTS||products.length===0)return products;
 const missing=()=>products.map(product=>({...product,return_policy_unavailable:true}));
 if(!z.string().uuid().safeParse(workspaceId).success||!z.string().uuid().safeParse(agentId).success)return missing();
 const ids=Array.from(new Set(products.map(product=>product.id))).slice(0,80);
 if(ids.some(id=>!z.string().uuid().safeParse(id).success))return missing();
 try{
  const result=await db.rpc('read_agent_product_return_policies',{p_workspace_id:workspaceId,p_agent_id:agentId,p_product_ids:ids});
  if(result.error)return missing();const parsed=z.array(productPolicySnapshot).max(80).safeParse(result.data);
  if(!parsed.success||parsed.data.length!==ids.length||new Set(parsed.data.map(row=>row.product_id)).size!==ids.length||parsed.data.some(row=>!ids.includes(row.product_id)))return missing();
  const byId=new Map(parsed.data.map(row=>[row.product_id,row]));
  return products.map(product=>{const snapshot=product.id?byId.get(product.id):undefined;return snapshot?{...product,return_policy:snapshot}:{...product,return_policy_unavailable:true};});
 }catch{return missing();}
}
