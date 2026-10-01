import {httpActionApi} from '@/lib/integrations/http-action-api';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return httpActionApi(request,'runs',(await params).id);}
