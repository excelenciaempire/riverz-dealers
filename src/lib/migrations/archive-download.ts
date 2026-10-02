import 'server-only';
import {request} from 'node:https';
import type {IncomingMessage} from 'node:http';
import type {LookupFunction} from 'node:net';
import {publicMediaLookup} from '@/lib/security/download-public-media';
import {isPublicHttpsUrl} from '@/lib/security/url-guard';
import {ARCHIVE_MAX_FILE_BYTES} from './archive-contract';
const allowedMime=new Set(['application/octet-stream','application/pdf','application/zip','text/plain','text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png','image/jpeg','image/webp','image/gif','audio/mpeg','audio/ogg','audio/wav','video/mp4']);
export class ArchiveFileError extends Error{
  constructor(readonly code:'source_invalid'|'source_changed'|'source_limit'|'source_auth'|'source_rate_limit'|'source_timeout'|'source_unavailable'){super(code);}
}
/** Input must be an authenticated, scoped stored reference. No provider token,
 * browser cookies, arbitrary headers or raw exception/URL logging. Downloads
 * remain private and are served as attachments, never arbitrary inline HTML. */
export async function downloadArchiveFile(reference:string,expectedBytes:number|null,maxBytes=ARCHIVE_MAX_FILE_BYTES){
  if(typeof reference!=='string'||reference.length>2048||!isPublicHttpsUrl(reference)||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>ARCHIVE_MAX_FILE_BYTES||
    expectedBytes!==null&&(!Number.isInteger(expectedBytes)||expectedBytes<0||expectedBytes>ARCHIVE_MAX_FILE_BYTES))throw new ArchiveFileError('source_invalid');
  if(expectedBytes!==null&&expectedBytes>maxBytes)throw new ArchiveFileError('source_limit');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  let response:IncomingMessage|undefined;
  const bounded=<T>(promise:Promise<T>)=>new Promise<T>((resolve,reject)=>{
    const expired=()=>reject(new ArchiveFileError('source_timeout'));
    if(controller.signal.aborted){expired();return;}
    controller.signal.addEventListener('abort',expired,{once:true});
    promise.then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',expired));
  });
  try{
    let url=new URL(reference);
    for(let hop=0;hop<=3;hop++){
      response=undefined;
      if(!isPublicHttpsUrl(url.href))throw new ArchiveFileError('source_invalid');
      const pinned=await bounded(publicMediaLookup(url));controller.signal.throwIfAborted();
      let last:unknown;
      for(const address of pinned.addresses){
        try{
          const lookup:LookupFunction=(_hostname,options,callback)=>{if(options.all)callback(null,[address]);else callback(null,address.address,address.family);};
          response=await bounded(new Promise<IncomingMessage>((resolve,reject)=>{
            const outgoing=request(url,{method:'GET',agent:false,lookup,rejectUnauthorized:true,maxHeaderSize:16384,signal:controller.signal,
              headers:{accept:'*/*','accept-encoding':'identity','user-agent':'Riverz/1.0 (+https://riverz.co)'}},incoming=>{
                if(controller.signal.aborted){incoming.destroy();reject(new ArchiveFileError('source_timeout'));}else resolve(incoming);
              });
            outgoing.once('error',reject);outgoing.end();
          }));break;
        }catch(error){last=error;if(controller.signal.aborted)throw error;}
      }
      if(!response)throw last??new ArchiveFileError('source_unavailable');
      const status=response.statusCode??0;
      if([301,302,303,307,308].includes(status)){
        const location=response.headers.location;response.destroy();response=undefined;
        if(!location||hop===3)throw new ArchiveFileError('source_unavailable');url=new URL(location,url);continue;
      }
      if(status===401||status===403)throw new ArchiveFileError('source_auth');if(status===429)throw new ArchiveFileError('source_rate_limit');
      if(status<200||status>=300)throw new ArchiveFileError('source_unavailable');
      if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new ArchiveFileError('source_invalid');
      const length=response.headers['content-length'];
      if(length!==undefined&&(typeof length!=='string'||!/^\d+$/.test(length)))throw new ArchiveFileError('source_invalid');
      if(length!==undefined&&Number(length)>maxBytes)throw new ArchiveFileError('source_limit');
      const mime=(response.headers['content-type']??'application/octet-stream').split(';')[0].trim().toLowerCase();
      if(!allowedMime.has(mime))throw new ArchiveFileError('source_invalid');
      const chunks:Buffer[]=[];let bytes=0;
      const incoming=response;
      await bounded((async()=>{for await(const chunk of incoming){
        const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=data.length;if(bytes>maxBytes)throw new ArchiveFileError('source_limit');chunks.push(data);
      }})());
      if(expectedBytes!==null&&bytes!==expectedBytes||length!==undefined&&bytes!==Number(length))throw new ArchiveFileError('source_changed');
      return {buffer:Buffer.concat(chunks),mime};
    }
    throw new ArchiveFileError('source_unavailable');
  }catch(error){
    if(controller.signal.aborted)throw new ArchiveFileError('source_timeout');if(error instanceof ArchiveFileError)throw error;throw new ArchiveFileError('source_unavailable');
  }finally{clearTimeout(timer);response?.destroy();controller.abort();}
}
