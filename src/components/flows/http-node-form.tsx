'use client';
import { createContext, useContext, useState } from 'react';
import { z } from 'zod';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { httpFlowConfig, httpFlowConfigMatches } from '@/lib/flows/http-contract';

export const FlowHttpEditorContext = createContext<{ flowId:string; workspaceId:string; dirty:boolean; preview:boolean } | null>(null);
const choice = z.object({ id:z.string().uuid(),revision:z.number().int().positive(),name:z.string(),
  inputs:z.array(z.object({key:z.string(),required:z.boolean(),type:z.enum(['string','number','boolean'])})).max(12),outputs:z.array(z.string()).max(12) });
const grant = z.object({ node_key:z.string(),revision:z.number().int().positive(),state:z.enum(['active','withdrawn']),node_config:httpFlowConfig });
const catalog = z.object({actions:z.array(choice).max(20),grants:z.array(grant).max(200)});
const inputClass='w-full rounded-md border border-border bg-background px-2 py-1 text-sm';
const buttonClass='rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50';

export function HttpFlowNodeForm(props:{nodeKey:string;config:Record<string,unknown>;onUpdateConfig:(patch:Record<string,unknown>)=>void}) {
  const ctx=useContext(FlowHttpEditorContext);
  return SHOW_RIVERZ_IMPROVEMENTS ? <Controls key={`${ctx?.workspaceId}:${ctx?.flowId}:${props.nodeKey}`} {...props}/> : null;
}
function Controls({nodeKey,config,onUpdateConfig}:{nodeKey:string;config:Record<string,unknown>;onUpdateConfig:(patch:Record<string,unknown>)=>void}) {
  const ctx=useContext(FlowHttpEditorContext), t=useT(), fetchWithCsrf=useFetchWithCsrf();
  const [data,setData]=useState<z.infer<typeof catalog>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const selected=data?.actions.find(row=>row.id===config.action_id && row.revision===config.action_revision);
  const existing=data?.grants.find(row=>row.node_key===nodeKey),parsed=httpFlowConfig.safeParse(config);
  const authorized=existing?.state==='active' && parsed.success
    && httpFlowConfigMatches(existing.node_config,parsed.data);
  const endpoint=ctx ? `/api/flows/${ctx.flowId}/http-grants` : '';
  async function load() {
    if (!ctx || ctx.preview || busy) return;setBusy(true);setError(false);
    try {
      const response=await fetch(endpoint,{headers:{'x-riverz-workspace':ctx.workspaceId},cache:'no-store'});
      const parsed=catalog.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('unavailable');setData(parsed.data);
    } catch { setError(true); } finally {setBusy(false);}
  }
  async function authorize(operation:'save'|'withdraw') {
    if (!ctx || ctx.preview || ctx.dirty || busy || !data || (operation==='save' && !parsed.success)) return;
    setBusy(true);setError(false);
    try {
      const response=await fetchWithCsrf(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-riverz-workspace':ctx.workspaceId},
        body:JSON.stringify({operation,node_key:nodeKey,expected_revision:existing?.revision??0,
          ...(operation==='save' && parsed.success ? {reviewed_config:parsed.data}:{})})});
      const result=grant.safeParse(await response.json());if (!response.ok || !result.success) throw new Error('unavailable');
      setData(previous=>previous ? {...previous,grants:[...previous.grants.filter(row=>row.node_key!==nodeKey),result.data]}:previous);
    } catch {setError(true);} finally {setBusy(false);}
  }
  return <div className="space-y-2">
    <button type="button" className={buttonClass} disabled={busy||!ctx||ctx.preview} onClick={()=>void load()}>{t('flows.httpLoad')}</button>
    {data && <>
      <label className="block text-xs">{t('flows.httpAction')}<select className={inputClass} value={String(config.action_id??'')} onChange={event=>{
        const found=data.actions.find(row=>row.id===event.target.value);onUpdateConfig({action_id:found?.id??'',action_revision:found?.revision??0,input_vars:{}});
      }}><option value="">{t('flows.httpChoose')}</option>{data.actions.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {selected?.inputs.map(field=><label key={field.key} className="block text-xs">{field.key}{field.required?' *':''}
        <input className={inputClass} maxLength={48} value={String((config.input_vars as Record<string,unknown>|undefined)?.[field.key]??'')}
          placeholder={t('flows.httpVariable')} onChange={event=>{
            const vars={...(config.input_vars as Record<string,string>|undefined)};
            if (event.target.value) vars[field.key]=event.target.value;else delete vars[field.key];onUpdateConfig({input_vars:vars});
          }}/></label>)}
      <label className="block text-xs">{t('flows.httpPrefix')}<input className={inputClass} maxLength={48}
        value={String(config.output_prefix??'')} onChange={event=>onUpdateConfig({output_prefix:event.target.value})}/></label>
      {selected && <p className="text-xs text-muted-foreground">{selected.outputs.map(name=>`${String(config.output_prefix??'system')}_${name}`).join(', ')}</p>}
      {ctx?.dirty && <p className="text-xs text-muted-foreground">{t('flows.httpSaveFirst')}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy||ctx?.dirty||ctx?.preview||!selected||!parsed.success||authorized}
          onClick={()=>void authorize('save')}>{t(authorized?'flows.httpAuthorized':'flows.httpAuthorize')}</button>
        {existing?.state==='active' && <button type="button" className={buttonClass} disabled={busy||ctx?.dirty||ctx?.preview}
          onClick={()=>void authorize('withdraw')}>{t('flows.httpWithdraw')}</button>}
      </div>
    </>}
    {error && <p role="alert" className="text-xs text-destructive">{t('flows.httpUnavailable')}</p>}
  </div>;
}
