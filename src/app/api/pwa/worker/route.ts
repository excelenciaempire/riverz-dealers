import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {notificationWorker} from '@/lib/pwa/notification-worker';
export const dynamic='force-dynamic';
export function GET(){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
 return new Response(notificationWorker,{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','Service-Worker-Allowed':'/','X-Content-Type-Options':'nosniff'}});
}
