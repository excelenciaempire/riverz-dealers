import { describe, expect, it } from 'vitest';
import {
  destinatarioCliente,
  direccionesDeCorreo,
  direccionesPropias,
} from './direcciones';

describe('direccionesDeCorreo', () => {
  it('respeta la coma dentro del nombre', () => {
    expect(direccionesDeCorreo('"Pérez, Ana" <Ana@X.com>, luis@y.com')).toEqual([
      { email: 'ana@x.com', name: 'Pérez, Ana' },
      { email: 'luis@y.com', name: '' },
    ]);
  });

  it('entiende las entidades HTML que devuelve Zoho', () => {
    expect(
      direccionesDeCorreo('&quot;rebecca&quot;&lt;rebecca@zylker.com&gt;'),
    ).toEqual([{ email: 'rebecca@zylker.com', name: 'rebecca' }]);
  });

  it('ignora lo que no es una dirección', () => {
    expect(direccionesDeCorreo('Not Provided')).toEqual([]);
    expect(direccionesDeCorreo(undefined)).toEqual([]);
  });

  it('no repite la misma dirección', () => {
    expect(direccionesDeCorreo('a@x.com; A@X.com')).toHaveLength(1);
  });
});

describe('destinatarioCliente', () => {
  const propias = direccionesPropias({
    config: { email: 'Tienda@Shop.com' },
    external_account_id: 'tienda@shop.com',
  });

  it('saltea el propio buzón aunque vaya primero', () => {
    expect(
      destinatarioCliente(['tienda@shop.com, "Ana" <ana@x.com>'], propias),
    ).toEqual({ email: 'ana@x.com', name: 'Ana' });
  });

  it('si en el To sólo está el buzón, mira el Cc', () => {
    expect(destinatarioCliente(['tienda@shop.com', 'luis@y.com'], propias)?.email).toBe(
      'luis@y.com',
    );
  });

  it('un correo que el comercio se mandó a sí mismo no tiene cliente', () => {
    expect(destinatarioCliente(['tienda@shop.com', undefined], propias)).toBeNull();
  });
});
