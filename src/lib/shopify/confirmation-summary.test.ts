import { describe, expect, it } from 'vitest';
import { confirmationSummary } from './confirmation-summary';

describe('confirmationSummary', () => {
  it('includes every product, variant, quantity and delivery field', () => {
    expect(confirmationSummary({
      line_items: [{ title: 'Saltarín', variant_title: 'Rana', quantity: 2 }, { title: 'Otro producto', variant_title: 'Default Title', quantity: 1 }],
      shipping_address: { first_name: 'Ana', last_name: 'Pérez', address1: 'Calle 1', address2: 'Apto 2', city: 'Cali', province: 'Valle', phone: '+573000000000' },
    })).toEqual({ order_items: '2 × Saltarín (Rana); 1 × Otro producto', delivery_address: 'Calle 1, Apto 2, Cali, Valle', delivery_phone: '+573000000000', recipient_name: 'Ana Pérez' });
  });
  it('does not invent missing customer data or emit empty Meta parameters', () => {
    expect(confirmationSummary({})).toEqual({ order_items: '—', delivery_address: '—', delivery_phone: '—', recipient_name: '—' });
  });
  it('removes newlines and tabs from Meta parameter values', () => {
    expect(confirmationSummary({shipping_address: {name:'Ana\nPérez',address1:'Calle\t1'},phone:'+573000000000'})).toMatchObject({recipient_name:'Ana Pérez',delivery_address:'Calle 1',delivery_phone:'+573000000000'});
  });
});
