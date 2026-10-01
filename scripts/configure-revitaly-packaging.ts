/** Dry run by default. --apply saves the merchant-approved response for every Revitaly agent. */
import {createClient} from '@supabase/supabase-js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {REVITALY_PACKAGING_NOTICE,REVITALY_PACKAGING_RULE} from '../src/lib/ai/revitaly-packaging';
const workspaceId='234604a9-909b-4e50-952b-acde4a85593a';
async function main(){
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const existing=await db.from('agent_guidance').select('*').eq('workspace_id',workspaceId).eq('clave',REVITALY_PACKAGING_RULE).is('agent_id',null);
  if(existing.error)throw existing.error;if(existing.data.length>1)throw new Error('Ambiguous packaging policy');
  const apply=process.argv.includes('--apply');console.log(JSON.stringify({apply,workspaceId,rule:REVITALY_PACKAGING_RULE}));if(!apply)return;
  mkdirSync('output/revitaly-packaging',{recursive:true});writeFileSync(`output/revitaly-packaging/rule-before-${Date.now()}.json`,JSON.stringify(existing.data,null,2));
  const policy={workspace_id:workspaceId,agent_id:null,clave:REVITALY_PACKAGING_RULE,
    titulo:'Aclaración oficial del cambio de envase',orden:-10,activa:true,origen:'comercio',
    cuando:'El cliente consulta o reclama por un envase diferente, negro, redondo o cilíndrico respecto al envase ámbar habitual o a la foto de Revitaly.',
    hacer:`Responde exactamente con este aviso autorizado por el comercio, sin añadir presentación del agente ni redirigir la consulta a WhatsApp. Aplica en todos los canales, incluido Mercado Libre dentro de su plataforma. No pidas fotos ni escales solo por este cambio de presentación. En Mercado Libre, divide por párrafos si el límite de la plataforma lo exige. Si también reclama daños, dosificadores rotos, faltantes o pide a una persona, comparte la aclaración y conserva la atención del problema adicional. No uses este aviso para sustituir reclamos regulatorios, de salud, de devolución o de un producto o marca distintos. No confirmes pagos, reposiciones ni resoluciones que no hayan ocurrido. Respeta las conversaciones tomadas por el equipo y las ventanas de envío.\n\n${REVITALY_PACKAGING_NOTICE}`};
  const result=existing.data[0]?await db.from('agent_guidance').update(policy).eq('id',existing.data[0].id).eq('workspace_id',workspaceId).eq('updated_at',existing.data[0].updated_at).select('id').single():await db.from('agent_guidance').insert(policy).select('id').single();
  if(result.error)throw result.error;
  const saved=await db.from('agent_guidance').select('id,activa,hacer').eq('id',result.data.id).eq('workspace_id',workspaceId).single();
  if(saved.error||!saved.data?.activa||!saved.data.hacer.includes(REVITALY_PACKAGING_NOTICE))throw new Error('Packaging rule verification failed');
  console.log(JSON.stringify({activated:true,id:saved.data.id,exactText:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
