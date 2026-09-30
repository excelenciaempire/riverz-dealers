import { describe, it, expect } from 'vitest';
import { claveDePregunta,registrarHueco } from './answer-gaps';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * La clave es lo único que hace accionable esta lista.
 *
 * Sin agrupar, doce personas preguntando lo mismo son doce tareas y la pantalla
 * no sirve para nada. Agrupadas son UN párrafo que falta escribir, y el número
 * de veces es lo que decide por dónde empezar.
 */
describe('claveDePregunta', () => {
  it('junta la misma pregunta escrita de distintas formas', () => {
    const esperada = claveDePregunta('¿Hacen envíos?');
    for (const forma of ['hacen envios', 'HACEN ENVÍOS', '  ¿Hacen  envíos?  ', 'Hacen envios!!']) {
      expect(claveDePregunta(forma), forma).toBe(esperada);
    }
  });

  it('no junta preguntas distintas', () => {
    expect(claveDePregunta('hacen envios')).not.toBe(claveDePregunta('hacen cambios'));
  });

  it('sobrevive a lo que no es texto normal', () => {
    expect(claveDePregunta('')).toBe('');
    expect(claveDePregunta('¿¿¿???')).toBe('');
    expect(claveDePregunta('🙂 envíos 🙂')).toBe('envios');
  });

  it('no crece sin límite', () => {
    // El texto lo escribe un desconocido y termina en un índice.
    expect(claveDePregunta('a'.repeat(1000)).length).toBeLessThanOrEqual(200);
  });
  it('preserves non-Latin questions and separates long questions with identical prefixes',() => {
    expect(claveDePregunta('配送はいつですか')).not.toBe('');
    expect(claveDePregunta('配送はいつですか')).not.toBe(claveDePregunta('返品はできますか'));
    expect(claveDePregunta('a'.repeat(220)+' one')).not.toBe(claveDePregunta('a'.repeat(220)+' two'));
  });
});
describe('truthful answer-gap receipts',() => {
 it('never claims the question was recorded or escalates the case if the insert failed',async() => {
  let escalated=false;
  const db={ from:(table:string) => table==='answer_gaps' ? { insert:async() => ({ error:{ message:'database unavailable' } }) } : { update:() => { escalated=true;throw new Error('must not escalate') } } } as unknown as SupabaseClient;
  expect(JSON.parse(await registrarHueco({ db,workspaceId:'w',contactId:'c',conversationId:'case' },{ pregunta:'Delivery date?' }))).toMatchObject({ ok:false });expect(escalated).toBe(false);
 });
 it('distinguishes recorded knowledge gaps from unconfirmed handoff',async() => {
  const q={ update:() => q,eq:() => q,select:() => q,maybeSingle:async() => ({ error:{ message:'handoff failed' },data:null }) };
  const db={ from:(table:string) => table==='answer_gaps' ? { insert:async() => ({ error:null }) } : q } as unknown as SupabaseClient;
  expect(JSON.parse(await registrarHueco({ db,workspaceId:'w',contactId:'c',conversationId:'case' },{ pregunta:'Delivery date?' }))).toMatchObject({ ok:true,handoff_confirmed:false });
 });
 it('rejects nontext and empty normalized questions before any database write',async() => {
  const db={ from:() => { throw new Error('must not write') } } as unknown as SupabaseClient;
  for (const pregunta of [null,42,'???']) expect(JSON.parse(await registrarHueco({ db,workspaceId:'w',contactId:'c' },{ pregunta:pregunta as unknown as string }))).toMatchObject({ ok:false });
 });
})
