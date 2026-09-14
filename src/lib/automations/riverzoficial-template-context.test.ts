import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireRiverzoficialTemplateItems, RIVERZOFICIAL_WORKSPACE } from './riverzoficial-template-context';
import { productTemplates } from '../../../scripts/riverzoficial-copy';
const name = 'deuna_carrito_producto_v1';
function fixture(data: unknown) {
  const query = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.limit.mockReturnValue(query);
  return { query, db: { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient };
}
describe('riverzoficial product-personalized templates', () => {
  it('reads the exact cart in this workspace, preserving every product and variant', async () => {
    const {db,query}=fixture({line_items:[{title:'Pelota LED',variant_title:'Rana Verde',quantity:1},{title:'Botella',variant_title:'Azul',quantity:2}]});
    const vars:Record<string,unknown>={checkout_url:'https://shop.test/cart/a',order_items:'Old item',last_product:'Unrelated item'};
    await requireRiverzoficialTemplateItems(db,RIVERZOFICIAL_WORKSPACE,name,vars);
    expect(vars.order_items).toBe('1 × Pelota LED (Rana Verde); 2 × Botella (Azul)');
    expect(query.eq).toHaveBeenCalledWith('workspace_id',RIVERZOFICIAL_WORKSPACE);
    expect(query.eq).toHaveBeenCalledWith('abandoned_checkout_url',vars.checkout_url);
  });
  it('does not use last_product or stale items if the checkout is missing',async()=>{
    const {db}=fixture(null);
    await expect(requireRiverzoficialTemplateItems(db,RIVERZOFICIAL_WORKSPACE,name,{checkout_url:'missing',order_items:'Stale',last_product:'Other'})).rejects.toThrow('actual order or checkout items');
  });
  it('uses the triggering order rather than the contact history',async()=>{
    const {db}=fixture(null);const vars={order_items:'2 × Botella (Azul)',last_product:'Serum'};
    await requireRiverzoficialTemplateItems(db,RIVERZOFICIAL_WORKSPACE,'deuna_entregado_producto_v1',vars);
    expect(vars.order_items).toBe('2 × Botella (Azul)');expect(db.from).not.toHaveBeenCalled();
  });
  it('does not alter other merchants or legacy templates',async()=>{
    const {db}=fixture(null);
    await requireRiverzoficialTemplateItems(db,'other',name,{});
    await requireRiverzoficialTemplateItems(db,RIVERZOFICIAL_WORKSPACE,'legacy',{});
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(['','—','1 × —'])('blocks a productless message: %s',async order_items=>{
    const {db}=fixture(null);
    await expect(requireRiverzoficialTemplateItems(db,RIVERZOFICIAL_WORKSPACE,name,{order_items})).rejects.toThrow();
  });
  it('renders actual products without exposing the order number, in both languages',()=>{
    for(const template of productTemplates){
      expect(template.fields).not.toContain('order_number');
      for(const language of ['es','en'] as const){
        const rendered=template[language].replace(/\{\{(\d+)\}\}/g,(_,n)=>template.fields[Number(n)-1]==='order_items'?'2 × Botella (Azul)':'Ana');
        expect(rendered).toContain('2 × Botella (Azul)');
        expect(rendered).not.toMatch(/DeUNA Shop|1006|\{\{|saltar[ií]n|bouncing ball/i);
      }
    }
  });
});
