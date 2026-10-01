import { describe, expect, it, vi } from 'vitest';
import {configuredRevitalyPackagingNotice, loadRevitalyPackagingNotice, REVITALY_PACKAGING_NOTICE, REVITALY_PACKAGING_RULE, revitalyPackagingBurst, revitalyPackagingChunks, revitalyPackagingFormEmail, revitalyPackagingInquiry, revitalyPackagingNeedsContext} from './revitaly-packaging';
import { simularRespuesta } from './simulacion';
import { afirmaLoQueNoSabe } from '../instagram-agent/merece-respuesta';
const ws='234604a9-909b-4e50-952b-acde4a85593a';
const rule={workspace_id:ws,agent_id:null,clave:REVITALY_PACKAGING_RULE,activa:true,hacer:REVITALY_PACKAGING_NOTICE};
function database(){return {from:vi.fn((table:string)=>{
  const q:Record<string,unknown>={};for(const name of ['select','eq','is','maybeSingle'])q[name]=()=>q;
  q.then=(resolve:(v:unknown)=>void)=>resolve({data:table==='agent_guidance'?[rule]:null,error:null});return q;
})};}
describe('merchant-confirmed Revitaly packaging presentation',()=>{
  it.each(['Y el envase lo veo diferente','Hola el envase que me llegó no es el de la foto...',
    'Es una estafa, cambian el envase','Me llegaron 2 envases cilíndricos, no los que publican en la página',
    '¿Por qué enviaron el envase incorrecto?', 'Is the black bottle genuine?'])('answers the presentation question: %s',text=>{
    expect(revitalyPackagingInquiry(ws,text)).toEqual({additionalIssue:false});
  });
  it('keeps pump damage as a separate unresolved issue',()=>{
    expect(revitalyPackagingInquiry(ws,'Compré tres frascos. No sé si es otro producto de imitación. La publicación muestra envases rectangulares y recibí cilíndricos con sus dosificadores doblados.')).toEqual({additionalIssue:true});
  });
  it('still honors an explicit request for a person',()=>{
    expect(revitalyPackagingInquiry(ws,'El envase es diferente y quiero hablar con una persona')).toEqual({additionalIssue:true});
  });
  it('keeps unanswered packaging context when the next part of the burst is a photo or authenticity question',()=>{
    const prior=[{sender_type:'customer',content_text:'El envase llegó diferente'},{sender_type:'bot',content_text:'Hola'}];
    expect(revitalyPackagingNeedsContext(ws,'¿Es original?',false)).toBe(true);
    expect(revitalyPackagingInquiry(ws,revitalyPackagingBurst('¿Es original?',prior))).toEqual({additionalIssue:false});
    expect(revitalyPackagingInquiry(ws,revitalyPackagingBurst('[Imagen]',prior))).toEqual({additionalIssue:false});
    expect(revitalyPackagingBurst('¿Es original?',[{sender_type:'bot',content_text:REVITALY_PACKAGING_NOTICE},...prior])).toBe('¿Es original?');
    expect(revitalyPackagingNeedsContext(ws,'¿Cuánto cuesta?',false)).toBe(false);
    expect(revitalyPackagingNeedsContext('other','[Imagen]',true)).toBe(false);
  });
  it.each(['Me llegó la botella rota','¿Cuántos envases incluye el pack?', 'El envase dice 1 mes, ¿son dos o cuatro?',
    'El envase negro no tiene lote ni ANMAT', 'Quiero reembolso por el envase negro',
    'El frasco tiene otra marca', 'Me enviaron otro producto en un envase negro', 'Gracias\n> El envase es diferente',
    'Gracias\nEl lunes escribió:\nEl envase diferente'])('does not suppress another issue or answer quoted old mail: %s',text=>{
    expect(revitalyPackagingInquiry(ws,text)).toBeNull();
  });
  it('requires the enabled merchant rule and never affects another workspace',async()=>{
    const db=database();expect(await loadRevitalyPackagingNotice(db as never,'other','Envase negro')).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
    expect(configuredRevitalyPackagingNotice([{...rule,activa:false}] as never,ws)).toBeNull();
    expect(configuredRevitalyPackagingNotice([rule,rule] as never,ws)).toBeNull();
    expect(configuredRevitalyPackagingNotice([{...rule,hacer:'Invented summary'}] as never,ws)).toBeNull();
    expect(afirmaLoQueNoSabe(REVITALY_PACKAGING_NOTICE)).toBe(false);
  });
  it.each(['whatsapp','instagram','gmail','mercadolibre','ig_comment','fb_comment','webchat'])('uses the exact notice before generic referrals in %s',async channel=>{
    const result=await simularRespuesta(database() as never,{id:'natalia',workspace_id:ws,language:'es'} as never,
      {message:'El envase es distinto al de la foto',simulatedChannel:channel as never,historial:[]});
    expect(result.reply).toBe(REVITALY_PACKAGING_NOTICE);expect(result.herramientas).toEqual([]);
    expect(result.usage.input_tokens).toBe(0);
  });
  it('sends the complete notice within Mercado Libre limits without external contacts',()=>{
    const chunks=revitalyPackagingChunks(REVITALY_PACKAGING_NOTICE,'mercadolibre','pack:123');
    expect(chunks).toHaveLength(4);expect(chunks.every(c=>c.length<=350)).toBe(true);
    expect(chunks.join('\n\n')).toContain('contenido y la fórmula');
    expect(chunks.join(' ')).not.toMatch(/whatsapp|http|@/i);
    expect(revitalyPackagingChunks(REVITALY_PACKAGING_NOTICE,'whatsapp')).toEqual([REVITALY_PACKAGING_NOTICE]);
  });
  it('extracts only the actual customer address from a confirmed Shopify contact form',()=>{
    const body='Recibiste un mensaje nuevo desde el formulario de contacto de tu\r\ntienda online.\r\nCorreo electrónico:\r\ncustomer@example.com\r\nComentario:\r\nMe llegaron envases cilíndricos distintos';
    expect(revitalyPackagingFormEmail(ws,'mailer@shopify.com',body)).toBe('customer@example.com');
    expect(revitalyPackagingFormEmail(ws,'untrusted@example.com',body)).toBeNull();
    expect(revitalyPackagingFormEmail(ws,'mailer@shopify.com','Envases diferentes\nCorreo electrónico:\ncustomer@example.com')).toBeNull();
  });
});
