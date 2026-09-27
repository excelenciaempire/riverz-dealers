import {expect, it} from 'vitest';
import {admiteFeedbackReal, feedbackGroupEnd, filasACaptura} from './feedback-real';
it('accepts only team and Riverz messages',()=>{
 for(const sender_type of ['agent','bot']) expect(admiteFeedbackReal({sender_type})).toBe(true);
 for(const sender_type of ['customer','system',null]) expect(admiteFeedbackReal({sender_type})).toBe(false);
});
it('shows one feedback button at the end of each consecutive outgoing group',()=>{
 const messages=['customer','bot','bot','customer','bot','bot'].map(sender_type=>({sender_type}));
 expect(messages.map((_,i)=>feedbackGroupEnd(messages,i))).toEqual([false,false,true,false,false,true]);
});
it('ignores deleted bubbles when locating the end of a reply group',()=>{
 const messages=[{sender_type:'bot'},{sender_type:'bot',deleted_at:'2026-09-27'}];
 expect(feedbackGroupEnd(messages,0)).toBe(true);
 expect(feedbackGroupEnd(messages,1)).toBe(false);
});
it('preserves whether the feedback concerns the customer or the team',()=>{
 const base={id:'m',created_at:'2026-09-27',sender_id:null,origin:null,template_name:null,content_text:'Consulta real'};
 expect(filasACaptura([{...base,sender_type:'customer'}])[0]).toMatchObject({k:'me',texto:'Consulta real'});
 expect(filasACaptura([{...base,sender_type:'agent'}])[0]).toMatchObject({k:'biz',nota:'Equipo'});
});
