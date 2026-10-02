import {notFound} from 'next/navigation';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {portalSlug} from '@/lib/help-portal/contract';
import {getLocale} from '@/lib/i18n/server';
import {PublicHelpPortal} from '@/components/help-portal/public-portal';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{slug:string}>}){
 if(!SHOW_RIVERZ_IMPROVEMENTS)notFound();const {slug}=await params;if(!portalSlug.safeParse(slug).success)notFound();
 return <PublicHelpPortal slug={slug} initialLocale={await getLocale()}/>;
}
