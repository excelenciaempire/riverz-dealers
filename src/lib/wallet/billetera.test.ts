import { describe, expect, it } from 'vitest';
import { rangoDe } from './movimientos';
import { puedeGastar, type Billetera } from './saldo';
import { milicentavosDe, type Tarifa } from './tarifas';

const tarifa = (precioMilicentavos: number, unidad = 'respuesta'): Tarifa => ({
  concepto: 'x',
  nombreEs: 'X',
  nombreEn: 'X',
  unidad,
  precioMilicentavos,
  activo: true,
  orden: 1,
});

const billetera = (over: Partial<Billetera> = {}): Billetera => ({
  workspaceId: 'ws-1',
  saldoCentavos: 1000,
  moneda: 'usd',
  descubiertoCentavos: 200,
  bloquearSinSaldo: true,
  autoRecargaCentavos: null,
  autoUmbralCentavos: null,
  tieneTarjeta: false,
  tarjetaMarca: null,
  tarjetaUltimos4: null,
  cobrarACosto: false,
  autoFallos: 0,
  autoUltimoError: null,
  ...over,
});

describe('cuánto se cobra por un consumo', () => {
  it('una respuesta a 2 centavos son 2000 milésimas', () => {
    expect(milicentavosDe(tarifa(2000), 1)).toBe(2000);
  });

  it('2,4 minutos a 20 centavos el minuto son 48 centavos', () => {
    expect(milicentavosDe(tarifa(20_000, 'minuto'), 2.4)).toBe(48_000);
  });

  it('lo que no llega a un centavo no se redondea a uno', () => {
    // Era el piso viejo: 0,05 centavos se cobraban como 1, veinte veces el
    // trabajo. Ahora sale entero y lo acumula la base hasta que sume.
    expect(milicentavosDe(tarifa(100), 0.5)).toBe(50);
  });

  it('cantidad cero no cobra nada', () => {
    expect(milicentavosDe(tarifa(2000), 0)).toBe(0);
  });
});

describe('quién puede gastar', () => {
  it('con saldo, sí', () => {
    expect(puedeGastar(billetera())).toBe(true);
  });

  it('sin saldo y con bloqueo, no', () => {
    expect(puedeGastar(billetera({ saldoCentavos: -200 }))).toBe(false);
  });

  it('el descubierto anterior no autoriza nuevos gastos', () => {
    expect(puedeGastar(billetera({ saldoCentavos: -50 }))).toBe(false);
  });

  it('una bandera antigua no habilita consumo sin saldo', () => {
    expect(
      puedeGastar(
        billetera({ saldoCentavos: -100_000, bloquearSinSaldo: false })
      )
    ).toBe(false);
  });
  it('no reutiliza el saldo reservado por otra operación', () => {
    expect(
      puedeGastar(billetera({ saldoCentavos: 100, reservadoCentavos: 100 }))
    ).toBe(false);
  });
});

describe('el rango que pide la pantalla', () => {
  it('sin nada, los últimos 30 días', () => {
    const r = rangoDe(null, null);
    const dias =
      (Date.parse(r.hasta) - Date.parse(r.desde)) / (24 * 60 * 60 * 1000);
    expect(Math.round(dias)).toBe(30);
  });

  it('una fecha inventada no se arrastra a la consulta', () => {
    const r = rangoDe('no soy una fecha', null);
    expect(Number.isFinite(Date.parse(r.desde))).toBe(true);
    expect(Number.isFinite(Date.parse(r.hasta))).toBe(true);
  });

  it('al revés se endereza', () => {
    const r = rangoDe('2026-08-20T00:00:00Z', '2026-08-10T00:00:00Z');
    expect(Date.parse(r.desde)).toBeLessThan(Date.parse(r.hasta));
  });
});
