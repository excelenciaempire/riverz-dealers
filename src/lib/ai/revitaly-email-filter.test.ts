import {expect, it} from 'vitest';
import {revitalyEmailDisposition as disposition} from './revitaly-email-filter';
const base = {workspaceId:'234604a9-909b-4e50-952b-acde4a85593a',channel:'gmail',from:'cliente@gmail.com',subject:'Re: Pedido #1530'};
it.each([
 ['store+123@t.shopifyemail.com','Tu pedido fue confirmado'],
 ['invoice+statements@stripe.com','Recibo de Riverz'],
 ['no-reply@proveedor.com','Tu compra'],
 ['invoice+statements@mail.anthropic.com','Receipt from Anthropic'],
 ['marketing@hello.klaviyo.com','New customers'],
 ['reviews@judge.me','Martín dejó una reseña para el producto Revitaly'],
 ['persona@gmail.com','Si te ayudo a conseguir 500 compradores activos, ¿quieres probarlo?'],
 ['cliente@gmail.com','Recibido\nEl lunes Revitaly escribió:\n¿Cuándo llega mi pedido?'],
 ['cliente@gmail.com','Gracias'],
])('ignores non-inquiries from %s', (from,text)=>expect(disposition({...base,from,text})).toBe('ignore'));
it.each(['Mi pedido no llegó','Quiero corregir la dirección','¿Cuánto cuesta?','#1530','How long does delivery take?',
 'Mi compra no llegó\nEl lunes Revitaly escribió:\nNo responder, correo automático de Shopify'])('redirects a real inquiry: %s',text=>expect(disposition({...base,text})).toBe('customer'));
it.each(['Carta documento por mi pedido','Notificarle formalmente como representante legal','Hola, ¿eres el gerente?',''])('does not auto-reply to ambiguous or legal mail',text=>expect(disposition({...base,text})).toBe('review'));
it('does not change other merchants or channels',()=>{
 expect(disposition({...base,workspaceId:'other',text:'hello'})).toBeNull();
 expect(disposition({...base,channel:'whatsapp',text:'hello'})).toBeNull();
});
