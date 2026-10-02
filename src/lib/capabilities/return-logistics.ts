import {z} from 'zod';
import {translate} from '@/lib/i18n/translate';
import {formatDateTime,formatNumber} from '@/lib/i18n/format';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {gapCapabilityActor} from '@/lib/ai/gap-knowledge-actions';
import {readReturnLogistics,recordReturnLogistics,ReturnLogisticsError} from '@/lib/returns/logistics';
import {returnLogisticsInput} from '@/lib/returns/logistics-contract';
import {prepareReturnRefund,readReturnRefundContext,ReturnRefundError} from '@/lib/returns/refund-link';
import {returnRefundInput} from '@/lib/returns/refund-link-contract';
import type {Capability,CapabilityContext} from './types';
import {cambio} from './vistas';
const id={type:'string',format:'uuid'},date={type:'string',format:'date-time'};
const evidence=z.object({case_id:z.string().uuid(),entry:returnLogisticsInput}).strict();
const refund=z.object({case_id:z.string().uuid(),proposal:returnRefundInput}).strict();
const read=z.object({case_id:z.string().uuid(),cursor:z.string().min(1).max(512).optional()}).strict();
function actor(ctx:CapabilityContext){
 if(!SHOW_RIVERZ_IMPROVEMENTS)throw Error(translate(ctx.locale??'es','returns.notFound'));
 try{const value=gapCapabilityActor(ctx);if(!z.string().uuid().safeParse(value).success)throw Error('invalid');return value;}
 catch{throw Error(translate(ctx.locale??'es','returns.unauthorized'));}
}
function publicFailure(ctx:CapabilityContext,error:unknown):never{
 const locale=ctx.locale??'es';let key='logisticsFailed';
 if(error instanceof ReturnLogisticsError)key={invalid:'logisticsInvalid',forbidden:'unauthorized',notFound:'notFound',platformManaged:'platformManaged',changed:'decisionChanged',readOnly:'readOnly',limit:'logisticsLimit',unavailable:'logisticsFailed'}[error.code];
 if(error instanceof ReturnRefundError)key={invalid:'refundInvalid',notFound:'notFound',changed:'refundChanged',pending:'refundPending',readOnly:'readOnly',receiptRequired:'refundReceiptRequired',limited:'refundLimited',unavailable:'refundUnavailable'}[error.code];
 throw Error(translate(locale,`returns.${key}`));
}
export const RETURN_LOGISTICS_CAPABILITIES:Capability[]=[
 {
  key:'pedidos.historial_devolucion',risk:'lectura',
  description:'Lee guías y recepciones declaradas por el equipo en una devolución visible. Son declaraciones humanas, no recepción de transportadora ni prueba de reembolso. Devuelve updated_at exacto para preparar un registro y cursor de veinte eventos.',
  descriptionEn:'Reads team-reported tracking and receipts for a visible return. These are human attestations, not carrier receipts or proof of a refund. Returns the exact updated_at for a new record and a twenty-event cursor.',
  schema:{type:'object',properties:{case_id:id,cursor:{type:'string',maxLength:512}},required:['case_id']},
  async run(ctx,args){const who=actor(ctx),input=read.safeParse(args);if(!input.success)throw Error(translate(ctx.locale??'es','returns.logisticsInvalid'));
   try{return await readReturnLogistics(ctx.db,ctx.workspaceId,who,input.data.case_id,input.data.cursor);}catch(error){publicFailure(ctx,error);}
  },
 },
 {
  key:'pedidos.registrar_evidencia_devolucion',risk:'irreversible',
  description:'Tras revisión humana registra una guía de retorno o recepción real declarada por el miembro autenticado. No atribuyas recepción a un mensaje del cliente o al modelo. Una recepción marca el caso recibido pero no reembolsa, envía o compra etiquetas. Reutiliza entry.id en un reintento y el updated_at exacto del historial. Solo casos locales aprobados o recibidos.',
  descriptionEn:'After human review, records return tracking or an actual receipt reported by the authenticated member. Do not infer receiving from a customer message or model claim. Receipt marks the case received but does not refund, send or buy labels. Reuse entry.id when retrying and the exact history updated_at. Approved/received local cases only.',
  schema:{type:'object',properties:{case_id:id,entry:{oneOf:[
   {type:'object',additionalProperties:false,properties:{id,kind:{const:'guide'},expected_updated_at:date,payload:{type:'object',additionalProperties:false,properties:{carrier:{type:'string',minLength:1,maxLength:80},tracking_number:{type:'string',minLength:1,maxLength:100}},required:['carrier','tracking_number']}},required:['id','kind','expected_updated_at','payload']},
   {type:'object',additionalProperties:false,properties:{id,kind:{const:'receipt'},expected_updated_at:date,payload:{type:'object',additionalProperties:false,properties:{reference:{type:'string',minLength:1,maxLength:100},quantity:{type:'integer',minimum:1,maximum:10000},condition:{enum:['accepted','damaged','incomplete']},received_at:date,note:{type:'string',maxLength:500}},required:['reference','quantity','condition','received_at','note']}},required:['id','kind','expected_updated_at','payload']},
  ]}},required:['case_id','entry']},
  async preview(ctx,args){
   const who=actor(ctx),input=evidence.safeParse(args);if(!input.success)throw Error(translate(ctx.locale??'es','returns.logisticsInvalid'));
   try{const current=await readReturnLogistics(ctx.db,ctx.workspaceId,who,input.data.case_id);if(current.platform)throw new ReturnLogisticsError('platformManaged');if(current.updated_at!==input.data.entry.expected_updated_at||!['aprobada','recibida'].includes(current.status))throw new ReturnLogisticsError('changed');}
   catch(error){publicFailure(ctx,error);}
   return translate(ctx.locale??'es',input.data.entry.kind==='receipt'?'returns.receiptSaveScope':'returns.logisticsScope');
  },
  async run(ctx,args){const who=actor(ctx),input=evidence.safeParse(args);if(!input.success)throw Error(translate(ctx.locale??'es','returns.logisticsInvalid'));
   try{return await recordReturnLogistics(ctx.db,ctx.workspaceId,who,input.data.case_id,input.data.entry);}catch(error){publicFailure(ctx,error);}
  },
  artifact(ctx,args){
   const input=evidence.safeParse(args),locale=ctx.locale??'es',t=(key:string)=>translate(locale,`returns.${key}`);
   const entry=input.success?input.data.entry:null;
   const fields=entry?.kind==='guide'?[{etiqueta:t('carrier'),despues:entry.payload.carrier},{etiqueta:t('trackingNumber'),despues:entry.payload.tracking_number}]:entry?.kind==='receipt'?
    [{etiqueta:t('receiptReference'),despues:entry.payload.reference},{etiqueta:t('receiptQuantity'),despues:formatNumber(entry.payload.quantity,locale)},{etiqueta:t('receiptCondition'),despues:t(`receipt_${entry.payload.condition}`)},
     {etiqueta:t('logistics_receipt'),despues:formatDateTime(entry.payload.received_at,locale)},...(entry.payload.note?[{etiqueta:t('receiptNote'),despues:entry.payload.note}]:[])]:[];
   return cambio({titulo:t(entry?`logistics_${entry.kind}`:'logisticsTitle'),que:t('logisticsRecord'),aviso:t(entry?.kind==='receipt'?'receiptSaveScope':'logisticsScope'),campos:fields});
  },
 },
 {
  key:'pedidos.preparar_reembolso_devolucion',risk:'reversible',inerte:true,
  description:'Prepara una propuesta de reembolso de una devolución recibida, ligada al último registro humano de recepción y al saldo actual comprobado de Shopify. No ejecuta ni aprueba dinero; la revisión final se hace en Pedidos del caso con el motor existente. No sirve para productos sin pedido/cliente verificados. amount=null usa saldo restante. Reutiliza proposal.id en reintentos.',
  descriptionEn:'Prepares a refund proposal for a received return, bound to the latest human receipt and verified live Shopify balance. Does not execute or approve money; final review is in the case’s orders through the existing engine. Requires a verified order/customer. amount=null uses remaining balance. Reuse proposal.id when retrying.',
  schema:{type:'object',properties:{case_id:id,proposal:{type:'object',additionalProperties:false,properties:{id,receipt_id:id,amount:{type:['number','null'],minimum:0.000001},reason:{type:'string',minLength:1,maxLength:300}},required:['id','receipt_id','amount','reason']}},required:['case_id','proposal']},
  async preview(ctx,args){const who=actor(ctx),input=refund.safeParse(args);if(!input.success)throw Error(translate(ctx.locale??'es','returns.refundInvalid'));
   try{const current=await readReturnRefundContext(ctx.db,ctx.workspaceId,who,input.data.case_id);if(current.receipt.id!==input.data.proposal.receipt_id)throw new ReturnRefundError('changed');}catch(error){publicFailure(ctx,error);}
   return translate(ctx.locale??'es','returns.refundPrepareScope');
  },
  async run(ctx,args){const who=actor(ctx),input=refund.safeParse(args);if(!input.success)throw Error(translate(ctx.locale??'es','returns.refundInvalid'));
   try{return await prepareReturnRefund(ctx.db,ctx.workspaceId,who,input.data.case_id,input.data.proposal);}catch(error){publicFailure(ctx,error);}
  },
  artifact(ctx){const locale=ctx.locale??'es';return cambio({titulo:translate(locale,'returns.refundPrepare'),que:translate(locale,'returns.refundPrepareScope'),aviso:translate(locale,'returns.refundPreparedScope')});},
 },
];
