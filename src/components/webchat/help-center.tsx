'use client';
import {useEffect,useRef,useState} from 'react';
import type {z} from 'zod';
import type {Locale} from '@/lib/i18n/config';
import {translateMessages} from '@/lib/i18n/namespace';
import {assistant} from '@/lib/i18n/messages/assistant';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {widgetPortal} from '@/lib/help-portal/contract';
import {PortalArticles} from '@/components/help-portal/public-portal';
import {formatDateTime} from '@/lib/i18n/format';
export function WidgetHelpCenter({session,locale,onExpired}:{session:string;locale:Locale;onExpired:()=>void}){
 const [data,setData]=useState<z.infer<typeof widgetPortal>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[search,setSearch]=useState('');
 const controller=useRef<AbortController|null>(null),version=useRef(0);
 useEffect(()=>{const requests=controller,serial=version;serial.current++;requests.current?.abort();setData(null);setBusy(false);setSearch('');setError(false);
  return()=>{serial.current++;requests.current?.abort();};
 },[session,locale]);
 const t=(key:string)=>translateMessages(locale,assistant,key);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 async function load(){
  const serial=++version.current,abort=new AbortController();controller.current?.abort();controller.current=abort;setBusy(true);setError(false);setData(null);
  try{
   const response=await fetch(`/api/widget/help-portal?locale=${locale}`,{headers:{Authorization:`Bearer ${session}`},signal:abort.signal,cache:'no-store'});
   if(version.current!==serial)return;if(response.status===401){onExpired();return;}if(!response.ok)throw new Error('unavailable');
   const result=widgetPortal.parse(await response.json());if(version.current===serial)setData(result);
  }catch{if(version.current===serial&&!abort.signal.aborted)setError(true);}
  finally{if(version.current===serial)setBusy(false);}
 }
 const articles=data?.portal.articles.filter(row=>`${row.title}\n${row.body}`.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale)))??[];
 return <details className="mb-3 rounded-xl border p-3" onToggle={event=>{if(event.currentTarget.open){if(!busy)void load();}else{version.current++;controller.current?.abort();setData(null);setBusy(false);setSearch('');}}}>
  <summary className="cursor-pointer text-sm font-medium">{t('portalTitle')}</summary>
  <div className="mt-3 space-y-3 text-sm">{busy&&<p role="status">{t('portalLoading')}</p>}{error&&<button type="button" className="underline" onClick={()=>void load()}>{t('portal_not_found')}</button>}
   {data&&<>
    <label className="block"><span className="sr-only">{t('portalSearch')}</span><input className="w-full rounded border bg-background p-2" value={search} maxLength={200} placeholder={t('portalSearch')} onChange={event=>setSearch(event.target.value)}/></label>
    {!articles.length&&<p>{t(data.portal.articles.length?'portalNoResults':'portalEmpty')}</p>}
    <PortalArticles key={`${data.portal.slug}:${locale}`} portal={{...data.portal,articles}}/>
    {data.orders.length>0&&<section aria-label={t('portalOrders')} className="space-y-2"><h3 className="font-medium">{t('portalOrders')}</h3>{data.orders.map(order=><article key={order.id} className="rounded border p-3">
     <p className="font-medium">{order.reference}</p><p>{t('portalOrderStatus')}: {t(`portalOrder_${order.status}`)}</p><p className="text-xs text-muted-foreground">{formatDateTime(order.observed_at,locale)}</p>
    </article>)}</section>}
   </>}
  </div>
 </details>;
}
