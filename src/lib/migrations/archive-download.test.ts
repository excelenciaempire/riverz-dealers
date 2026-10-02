import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
const f=vi.hoisted(()=>({request:vi.fn(),lookup:vi.fn()}));
vi.mock('node:https',()=>({request:f.request}));
vi.mock('@/lib/security/download-public-media',()=>({publicMediaLookup:f.lookup}));
import {downloadArchiveFile} from './archive-download';
const url='https://files.example.test/signed?key=SECRET_REFERENCE';
function reply(status=200,headers:Record<string,string|undefined>={},body:Buffer|string='abc'){
  return Object.assign(Readable.from([Buffer.isBuffer(body)?body:Buffer.from(body)]),{statusCode:status,headers});
}
beforeEach(()=>{
  f.lookup.mockReset().mockResolvedValue({addresses:[{address:'8.8.8.8',family:4}]});
  f.request.mockReset().mockImplementation((_url,_options,callback)=>{
    const req=Object.assign(new EventEmitter(),{end(){callback(reply(200,{'content-type':'image/png','content-length':'3'}));}});return req;
  });
});
afterEach(()=>{vi.useRealTimers();});
describe('Private archive file download',()=>{
 it('pins public DNS and sends only a read with no provider credentials',async()=>{
   expect(await downloadArchiveFile(url,3)).toEqual({buffer:Buffer.from('abc'),mime:'image/png'});
   const options=f.request.mock.calls[0][1];expect(options).toMatchObject({method:'GET',agent:false,rejectUnauthorized:true,maxHeaderSize:16384});
   expect(Object.keys(options.headers).sort()).toEqual(['accept','accept-encoding','user-agent']);
   const cb=vi.fn();options.lookup('files.example.test',{all:false},cb);expect(cb).toHaveBeenCalledWith(null,'8.8.8.8',4);
 });
 it.each(['http://files.example.test/a','https://127.0.0.1/a','https://user:password@files.example.test/a','https://files.example.test/'+ 'x'.repeat(2048)])('rejects forbidden URL before DNS',async value=>{
   await expect(downloadArchiveFile(value,null)).rejects.toThrow('source_invalid');expect(f.lookup).not.toHaveBeenCalled();
 });
 it('redacts DNS failures and makes no connection',async()=>{
   f.lookup.mockRejectedValue(new Error('SECRET_REFERENCE private DNS'));await expect(downloadArchiveFile(url,null)).rejects.toThrow(/^source_unavailable$/);expect(f.request).not.toHaveBeenCalled();
 });
 it('rechecks and pins every redirect without forwarding source headers',async()=>{
   let i=0;f.request.mockImplementation((_url,_options,cb)=>Object.assign(new EventEmitter(),{end(){cb(i++===0?reply(302,{location:'https://cdn.example.test/file?secret=NEXT'}):reply(200,{'content-type':'application/pdf'}));}}));
   expect((await downloadArchiveFile(url,3)).mime).toBe('application/pdf');expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.request.mock.calls[1][0].origin).toBe('https://cdn.example.test');
 });
 it('rejects a redirect into private space before resolving it',async()=>{
   f.request.mockImplementation((_url,_options,cb)=>Object.assign(new EventEmitter(),{end(){cb(reply(302,{location:'https://169.254.169.254/metadata'}));}}));
   await expect(downloadArchiveFile(url,null)).rejects.toThrow('source_invalid');expect(f.lookup).toHaveBeenCalledOnce();
 });
 it('bounds redirects to three',async()=>{
   f.request.mockImplementation((_url,_options,cb)=>Object.assign(new EventEmitter(),{end(){cb(reply(302,{location:'/again'}));}}));
   await expect(downloadArchiveFile(url,null)).rejects.toThrow('source_unavailable');expect(f.request).toHaveBeenCalledTimes(4);
 });
 it.each([[401,'source_auth'],[403,'source_auth'],[429,'source_rate_limit'],[404,'source_unavailable'],[500,'source_unavailable']] as const)('redacts HTTP %s',async(status,code)=>{
   f.request.mockImplementation((_url,_options,cb)=>Object.assign(new EventEmitter(),{end(){cb(reply(status));}}));await expect(downloadArchiveFile(url,null)).rejects.toThrow(code);
 });
 it.each([{'content-type':'text/html'},{'content-encoding':'gzip'},{'content-length':'not-a-number'}])('rejects unsafe response representation',async headers=>{
   f.request.mockImplementation((_url,_options,cb)=>Object.assign(new EventEmitter(),{end(){cb(reply(200,headers));}}));await expect(downloadArchiveFile(url,null)).rejects.toThrow('source_invalid');
 });
 it('bounds streamed bytes even without Content-Length',async()=>{
   f.request.mockImplementation((_url,_options,cb)=>Object.assign(new EventEmitter(),{end(){cb(reply());}}));await expect(downloadArchiveFile(url,null,2)).rejects.toThrow('source_limit');
 });
 it('rejects declared size before reading and size drift after reading',async()=>{
   await expect(downloadArchiveFile(url,null,2)).rejects.toThrow('source_limit');await expect(downloadArchiveFile(url,4)).rejects.toThrow('source_changed');
 });
 it('tries only verified addresses when a connection fails',async()=>{
   f.lookup.mockResolvedValue({addresses:[{address:'8.8.8.8',family:4},{address:'1.1.1.1',family:4}]});let i=0;
   f.request.mockImplementation((_url,_options,cb)=>{const req=Object.assign(new EventEmitter(),{end(){if(i++===0)req.emit('error',new Error('SECRET'));else cb(reply());}});return req;});
   expect((await downloadArchiveFile(url,3)).buffer.length).toBe(3);expect(f.request).toHaveBeenCalledTimes(2);
 });
 it('bounds a hung resolver to eight seconds',async()=>{
   vi.useFakeTimers();f.lookup.mockImplementation(()=>new Promise(()=>{}));const outcome=expect(downloadArchiveFile(url,null)).rejects.toThrow('source_timeout');await vi.advanceTimersByTimeAsync(8000);await outcome;
 });
 it('bounds a stalled body and destroys its stream',async()=>{
   vi.useFakeTimers();const incoming=Object.assign(new Readable({read(){}}),{statusCode:200,headers:{}});
   f.request.mockImplementation((_url,_options,cb)=>Object.assign(new EventEmitter(),{end(){cb(incoming);}}));
   const outcome=expect(downloadArchiveFile(url,null)).rejects.toThrow('source_timeout');await vi.advanceTimersByTimeAsync(8000);await outcome;expect(incoming.destroyed).toBe(true);
 });
});
