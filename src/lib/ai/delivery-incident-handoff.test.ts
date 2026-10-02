import {describe,expect,it} from 'vitest';
import {bloquesDeEntrega,construirHerramientas} from './runner';
import {deliveryIncidentContext} from '@/lib/automations/delivery-incident-context';
import {purchaseConfirmationReply} from './purchase-confirmation-reply';
import type {AiAgent} from './types';
const id='11111111-1111-4111-8111-111111111111';
const agent={id,workspace_id:'22222222-2222-4222-8222-222222222222',assigned_only:true,tools:{crear_pedido:'auto',crear_checkout:'auto',crear_cupon:'auto',lookup_order:'auto',editar_pedido:'aprobacion',reembolsar:'aprobacion'},permissions:null} as unknown as AiAgent;
const context=deliveryIncidentContext(id,'shopify_order_incident_opened',{delivery_incident_context:true},{order_id:'42',incident_source:'shopify_tag',incident_status:'active',order_items:'Example',delivery_address:'Synthetic address'})!;
describe('Delivery issue uses the same assistant without reopening the sale',()=>{
 it('replaces recovery instructions for an assigned-only agent with delivery handling',()=>{
  const prompt=bloquesDeEntrega(agent,context,'whatsapp');expect(prompt).toContain('DELIVERY ISSUE FOLLOW-UP');expect(prompt).not.toContain('RECUPERACIÓN ASIGNADA');expect(prompt).not.toContain('antes del despacho');
 });
 it('removes new-order, checkout and coupon tools while preserving current-order reads and approved post-sale actions',()=>{
  const tools=construirHerramientas({agent,hayContacto:true,shopify:{config:null,canCreateOrders:true} as never,otherStore:null,voiceCtx:null,topeDescuento:10,deliveryIssue:true});const names=tools.map(tool=>'name' in tool?tool.name:undefined);
  expect(names).toContain('lookup_order');expect(names).not.toContain('create_order');expect(names).not.toContain('create_checkout');expect(names).not.toContain('create_coupon');
  expect(construirHerramientas({agent,hayContacto:true,shopify:{config:null,canCreateOrders:true} as never,otherStore:null,voiceCtx:null,topeDescuento:10}).map(tool=>'name' in tool?tool.name:undefined)).toContain('create_order');
 });
 it('does not mistake a delivery correction for the existing DeUNA purchase confirmation',()=>{
  expect(purchaseConfirmationReply({workspaceId:'36f81b96-41b9-4d29-b72e-11be3d3070a3',language:'es',text:'CONFIRMAR',context})).toBeNull();
 });
});
