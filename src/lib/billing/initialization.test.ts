import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asegurarSuscripcion, leerSuscripcion } from './plan';

it('never turns a database failure into a missing subscription', async () => {
  const error = new Error('database unavailable');
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({data:null,error}) };
  await expect(leerSuscripcion({from:()=>q} as unknown as SupabaseClient,'own')).rejects.toThrow(error);
});
it('does not overwrite an active subscription created concurrently with onboarding', async () => {
  let reads=0;
  const active = {workspace_id:'own',estado:'activa',billing_plans:null,precio_centavos_override:1000,incluidas_override:50,excedente_centavos_override:5};
  const upsert=vi.fn(async()=>({error:null}));
  const q={select:()=>q,eq:()=>q,order:async()=>({data:[],error:null}),maybeSingle:async()=>({data:reads++?active:null,error:null}),upsert};
  const result=await asegurarSuscripcion({from:()=>q} as unknown as SupabaseClient,'own');
  expect(upsert).toHaveBeenCalledWith(expect.anything(),{onConflict:'workspace_id',ignoreDuplicates:true});
  expect(result.estado).toBe('activa'); expect(result.precioCentavos).toBe(1000);
});
