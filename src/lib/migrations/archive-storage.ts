import 'server-only';
import {createHash} from 'node:crypto';
import {archiveStoredFile,ARCHIVE_MAX_FILE_BYTES} from './archive-contract';
export const ARCHIVE_BUCKET='migration-archives';
const pathSchema=archiveStoredFile.shape.path;
function endpoint(){
  const raw=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!raw||!key)throw new Error('source_unavailable');const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('source_unavailable');return {base:url.origin,key};
}
async function send(path:string,init:RequestInit){
  try{const {base,key}=endpoint();const response=await fetch(`${base}/storage/v1/object/${ARCHIVE_BUCKET}${path}`,{...init,
    headers:{...init.headers,apikey:key,authorization:`Bearer ${key}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw new Error('source_unavailable');}return response;
  }catch{throw new Error('source_unavailable');}
}
export async function uploadArchiveObject(path:string,buffer:Buffer,mime:string){
  if(!pathSchema.safeParse(path).success||buffer.length>ARCHIVE_MAX_FILE_BYTES||!mime||mime.length>160)throw new Error('source_invalid');
  const response=await send(`/${path}`,{method:'POST',headers:{'content-type':mime,'x-upsert':'false','cache-control':'max-age=0'},body:new Uint8Array(buffer)});
  await response.body?.cancel().catch(()=>undefined);
}
export async function removeArchiveObjects(paths:string[]){
  if(paths.length<1||paths.length>20||paths.some(path=>!pathSchema.safeParse(path).success))throw new Error('source_invalid');
  const response=await send('',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:paths})});await response.body?.cancel().catch(()=>undefined);
}
export async function downloadArchiveObject(input:unknown){
  const parsed=archiveStoredFile.safeParse(input);if(!parsed.success)throw new Error('source_invalid');const file=parsed.data;
  const response=await send(`/${file.path}`,{method:'GET'});const reader=response.body?.getReader();if(!reader)throw new Error('source_unavailable');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>file.bytes||bytes>ARCHIVE_MAX_FILE_BYTES)throw new Error('source_changed');chunks.push(item.value);}}
  catch{throw new Error('source_unavailable');}finally{await reader.cancel().catch(()=>undefined);}
  const buffer=Buffer.concat(chunks);if(bytes!==file.bytes||createHash('sha256').update(buffer).digest('hex')!==file.sha256)throw new Error('source_changed');
  return {buffer,mime:file.mime,fileId:file.fileId};
}
