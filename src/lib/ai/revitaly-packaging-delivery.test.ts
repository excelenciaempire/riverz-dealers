/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase query double */
import {beforeEach,describe,expect,it,vi} from 'vitest';
const {send}=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('@/lib/channels/registry',()=>({getAdapter:()=>({sendTemplate:send})}));
import {deliverQueuedRevitalyPackaging} from './revitaly-packaging-delivery';
import {REVITALY_PACKAGING_NOTICE,REVITALY_PACKAGING_RULE,REVITALY_PACKAGING_WAITING} from './revitaly-packaging';
const ws='234604a9-909b-4e50-952b-acde4a85593a';
function database(options:{approved?:boolean;body?:string;active?:boolean}={}){
  const message:any={id:'message',conversation_id:'conversation',status:'sending',error_reason:REVITALY_PACKAGING_WAITING};
  const db={from:vi.fn((table:string)=>{
    const filters:Record<string,unknown>={};let patch:any;let columns='';let single=false;
    const q:any={eq:(key:string,value:unknown)=>{filters[key]=value;return q;},is:()=>q,limit:()=>q,
      select:(value:string)=>{columns=value;return q;},update:(value:any)=>{patch=value;return q;},
      single:()=>{single=true;return q;},maybeSingle:()=>{single=true;return q;},
      then:(resolve:(value:any)=>void)=>{
        let data:any=null;
        if(table==='message_templates')data={waba_id:'waba',body_text:options.body??REVITALY_PACKAGING_NOTICE,status:options.approved===false?'Pending':'Approved',meta_status:options.approved===false?'PENDING':'APPROVED'};
        if(table==='agent_guidance')data=options.active===false?[]:[{workspace_id:ws,agent_id:null,clave:REVITALY_PACKAGING_RULE,activa:true,hacer:REVITALY_PACKAGING_NOTICE}];
        if(table==='messages'){
          if(patch){if(Object.entries(filters).every(([k,v])=>message[k]===v)){Object.assign(message,patch);data=single?{id:message.id}:null;}}
          else data=message.error_reason===REVITALY_PACKAGING_WAITING?[{id:message.id,conversation_id:message.conversation_id}]:[];
        }
        if(table==='conversations'&&!patch)data={id:'conversation',workspace_id:ws,contact_id:'contact',connection_id:'connection',channel:'whatsapp'};
        if(table==='contacts')data={id:'contact',workspace_id:ws,phone:'5491111111111'};
        if(table==='channel_connections')data={id:'connection',workspace_id:ws,channel:'whatsapp',config:{waba_id:'waba'}};
        void columns;resolve({data,error:null});
      }};return q;
  })};return {db,message};
}
describe('queued, merchant-authorized packaging notices',()=>{
  beforeEach(()=>{send.mockReset();send.mockResolvedValue({status:'sent',externalMessageId:'wamid.receipt'});});
  it('never sends for another merchant, pending approval, changed content or disabled rule',async()=>{
    const {db}=database();expect(await deliverQueuedRevitalyPackaging(db as never,'other')).toBe(0);expect(db.from).not.toHaveBeenCalled();
    for(const options of [{approved:false},{body:'Changed message'},{active:false}])expect(await deliverQueuedRevitalyPackaging(database(options).db as never,ws)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('claims the queue once when webhook and reconciliation race',async()=>{
    const {db,message}=database();
    const results=await Promise.all([deliverQueuedRevitalyPackaging(db as never,ws),deliverQueuedRevitalyPackaging(db as never,ws)]);
    expect(results.reduce((a,b)=>a+b,0)).toBe(1);expect(send).toHaveBeenCalledTimes(1);
    expect(message).toMatchObject({status:'sent',message_id:'wamid.receipt',error_reason:null});
  });
  it('records an uncertain send failure and never retries it automatically',async()=>{
    const {db,message}=database();send.mockRejectedValueOnce(new Error('Remote timeout'));
    await expect(deliverQueuedRevitalyPackaging(db as never,ws)).rejects.toThrow('Remote timeout');
    expect(message.status).toBe('failed');expect(await deliverQueuedRevitalyPackaging(db as never,ws)).toBe(0);expect(send).toHaveBeenCalledTimes(1);
  });
});
