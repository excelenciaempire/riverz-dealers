import {expect, it} from 'vitest';
import {admiteFeedbackReal, filasACaptura} from './feedback-real';
it('accepts all real message authors, not system events',()=>{
 for(const sender_type of ['customer','agent','bot']) expect(admiteFeedbackReal({sender_type})).toBe(true);
 for(const sender_type of ['system',null]) expect(admiteFeedbackReal({sender_type})).toBe(false);
});
it('preserves whether the feedback concerns the customer or the team',()=>{
 const base={id:'m',created_at:'2026-09-27',sender_id:null,origin:null,template_name:null,content_text:'Consulta real'};
 expect(filasACaptura([{...base,sender_type:'customer'}])[0]).toMatchObject({k:'me',texto:'Consulta real'});
 expect(filasACaptura([{...base,sender_type:'agent'}])[0]).toMatchObject({k:'biz',nota:'Equipo'});
});
