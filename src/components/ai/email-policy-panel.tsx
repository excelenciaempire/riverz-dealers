'use client';
import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {useT} from '@/hooks/use-locale';
import {useWorkspace} from '@/hooks/use-workspace';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {DEFAULT_EMAIL_POLICY,normalizeEmailPhone,type EmailPolicy} from '@/lib/ai/email-policy';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

export function EmailPolicyPanel(){
 const t=useT(),fetchCsrf=useFetchWithCsrf();
 const {workspace,isAdmin}=useWorkspace();
 const [policy,setPolicy]=useState<EmailPolicy>(DEFAULT_EMAIL_POLICY);
 const [loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false);
 useEffect(()=>{let active=true;setLoaded(false);
  fetch('/api/workspace/email-policy',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error();return r.json();})
   .then(p=>{if(active){setPolicy(p);setLoaded(true);}}).catch(()=>{if(active)toast.error(t('assistant.emailPolicyError'));});
  return()=>{active=false;};
 },[workspace?.id,t]);
 const save=async()=>{setSaving(true);try{
  const r=await fetchCsrf('/api/workspace/email-policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(policy)});
  if(!r.ok){const j=await r.json();throw new Error(j.error);}
  toast.success(t('assistant.emailPolicySaved'));
 }catch(e){toast.error(e instanceof Error&&e.message?e.message:t('assistant.emailPolicyError'));}finally{setSaving(false);}};
 return <details className="rounded-xl border p-4">
  <summary className="cursor-pointer text-sm font-medium">{t('assistant.emailPolicyTitle')}</summary>
  <fieldset disabled={!loaded||saving||!isAdmin} className="mt-4 grid gap-3 disabled:opacity-50 sm:max-w-xl">
   <label className="grid gap-1 text-sm">{t('assistant.emailPolicyMode')}
    <select className="rounded-md border bg-background px-3 py-2" value={policy.mode} onChange={e=>setPolicy({...policy,mode:e.target.value as EmailPolicy['mode']})}>
     <option value="redirect">{t('assistant.emailPolicyRedirect')}</option>
     <option value="assist">{t('assistant.emailPolicyAssist')}</option>
     <option value="manual">{t('assistant.emailPolicyManual')}</option>
    </select>
   </label>
   {policy.mode==='redirect'&&<label className="grid gap-1 text-sm">{t('assistant.emailPolicyPhone')}
    <Input value={policy.whatsapp_number} inputMode="tel" maxLength={25} onChange={e=>setPolicy({...policy,whatsapp_number:normalizeEmailPhone(e.target.value)})}/>
    {!policy.whatsapp_number&&<span className="text-xs text-amber-600">{t('assistant.emailPolicyMissing')}</span>}
   </label>}
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.filter_notifications} onChange={e=>setPolicy({...policy,filter_notifications:e.target.checked})}/>{t('assistant.emailPolicyFilter')}</label>
   {policy.mode==='redirect'&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.prevent_repeated_redirects} onChange={e=>setPolicy({...policy,prevent_repeated_redirects:e.target.checked})}/>{t('assistant.emailPolicyRepeat')}</label>}
   <Button className="w-fit" onClick={save}>{t('assistant.emailPolicySave')}</Button>
  </fieldset>
 </details>;
}
