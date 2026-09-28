import {expect,it,vi} from 'vitest';
import {summarizeMovements,resumen} from './movimientos';
import {movementContext,movementTokens} from './movement-context';
import {liquidar} from './operacion';
const range={desde:'2026-09-27T03:00:00Z',hasta:'2026-09-28T03:00:00Z'};
const row=(tipo:string,concepto:string,centavos:number)=>({tipo,concepto,centavos,cantidad:1,creado_en:'2026-09-27T19:00:00Z'});
it('does not count reimbursement as a top-up or internal processing as usage',()=>{
 const result=summarizeMovements([row('recarga','recarga',2500),row('consumo','comision_stripe',-140),row('ajuste','recarga_ajuste',140),row('consumo','ia_respuesta',-363),row('consumo','ia_clasificacion',-30)],range,'America/Argentina/Buenos_Aires');
 expect(result.cargadoCentavos).toBe(2500);
 expect(result.gastadoCentavos).toBe(393);
 expect(result.ajustesCentavos).toBe(0);
 expect(result.porConcepto.map(c=>c.concepto)).not.toContain('comision_stripe');
});
it('uses the reporting timezone for daily usage',()=>{
 const result=summarizeMovements([{...row('consumo','ia_respuesta',-10),creado_en:'2026-09-28T01:00:00Z'}],range,'America/Argentina/Buenos_Aires');
 expect(result.porDia[0].dia).toBe('2026-09-27');
});
it('reads beyond the PostgREST 1000-row cap',async()=>{
 const q={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),gte:vi.fn().mockReturnThis(),lt:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValueOnce({data:Array.from({length:1000},()=>row('consumo','ia_respuesta',-1)),error:null}).mockResolvedValueOnce({data:[row('consumo','ia_respuesta',-2)],error:null})};
 const result=await resumen({from:()=>q} as never,'ws',range);
 expect(result.gastadoCentavos).toBe(1002);expect(q.range).toHaveBeenCalledTimes(2);
});
it('keeps billing context when settling actual provider usage',async()=>{
 const db={rpc:vi.fn().mockResolvedValue({data:[],error:null})};
 await liquidar({db:db as never,workspaceId:'ws',concepto:'ia_respuesta',detalle:{para:'respuesta',conversacion:'chat'}},'operation','anthropic',0.01,{modelo:'model'});
 expect(db.rpc).toHaveBeenCalledWith('wallet_liquidar',expect.objectContaining({p_detalle:{para:'respuesta',conversacion:'chat',modelo:'model'}}));
});
it('shows useful activity context without exposing arbitrary internal data',()=>{
 const t=((key:string)=>key) as never;
 expect(movementContext({para:'escalada',canal:'whatsapp'},t)).toBe('settings.walletPurposeEscalation · WhatsApp');
 expect(movementContext({secret:'hidden',para:'unknown'},t)).toBeNull();
 expect(movementTokens({usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:1000}})).toBe(1150);
 expect(movementTokens({usage:{input_tokens:'100'}})).toBeNull();
});
