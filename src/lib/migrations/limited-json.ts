import {ContactMigrationError} from './contact-import';
/** Actual streamed bytes, not a trusted Content-Length. No unbounded request.json(). */
export async function readMigrationJson(request:Request,max=13*1024*1024):Promise<unknown>{
  if(!Number.isInteger(max)||max<1||max>13*1024*1024)throw new ContactMigrationError('invalid');
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new ContactMigrationError('invalid');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max)){await request.body?.cancel().catch(()=>undefined);throw new ContactMigrationError('invalid');}
  const reader=request.body?.getReader();if(!reader)throw new ContactMigrationError('invalid');let bytes=0;const chunks:Uint8Array[]=[];
  try{
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>max){await reader.cancel().catch(()=>undefined);throw new ContactMigrationError('invalid');}chunks.push(chunk.value);}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }catch{throw new ContactMigrationError('invalid');}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
