import {afterEach,expect,it,vi} from 'vitest';
const reconcile=vi.hoisted(()=>vi.fn());
vi.mock('./activation',()=>({reconcileWorkspaceAutomationReadiness:reconcile}));
vi.mock('@/lib/templates/create',()=>({resolverWabaYToken:async()=>({wabaId:'waba',accessToken:'test'})}));
vi.mock('@/lib/channels/meta-graph',()=>({withAppsecretProof:(url:string)=>url}));
vi.mock('@/lib/whatsapp/template-webhooks',()=>({normalizeTemplateStatusEvent:(s:string)=>s==='APPROVED'?'Approved':s==='PENDING'?'Pending':null}));
import {syncAutomationTemplates} from './template-status-sync';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()});
it('syncs approval by workspace, WABA, name and language without touching runs or messages',async()=>{
 const q={update:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),or:vi.fn().mockReturnThis(),select:vi.fn().mockResolvedValue({data:[{id:'t'}],error:null})};
 const owner={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:{owner_id:'owner'},error:null})};
 const from=vi.fn((table:string)=>{if(table==='workspaces')return owner;if(table==='message_templates')return q;throw Error('Unexpected write: '+table)});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({data:[{name:'t',language:'es',status:'APPROVED'}]})}));
 expect(await syncAutomationTemplates({from} as never,'ws')).toBe(1);
 for(const [k,v] of [['workspace_id','ws'],['waba_id','waba'],['name','t'],['language','es']])expect(q.eq).toHaveBeenCalledWith(k,v);
 expect(reconcile).toHaveBeenCalledOnce();expect(q.update).toHaveBeenCalledWith({status:'Approved',meta_status:'APPROVED'});
});
it('does not reconcile as ready when Meta cannot be checked',async()=>{
 const owner={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:{owner_id:'owner'},error:null})};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:503,json:async()=>({error:{code:2}})}));
 await expect(syncAutomationTemplates({from:()=>owner} as never,'ws')).rejects.toThrow('HTTP 503');
 expect(reconcile).not.toHaveBeenCalled();
});
