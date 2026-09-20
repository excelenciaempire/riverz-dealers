import { expect, it } from 'vitest';
import { workspaceWalletSummary } from './workspace-wallet';

it('does not flag courtesy accounts as stopped at zero balance', () => {
  expect(workspaceWalletSummary({ saldo_centavos: 0 }, { estado: 'cortesia' }).sinSaldo).toBe(false);
});
it('accounts for funds reserved by active operations', () => {
  expect(workspaceWalletSummary(
    { saldo_centavos: '100', reservado_centavos: '100' },
    { estado: 'activa', modelo_cobro: 'saldo' },
  ))
    .toMatchObject({ saldoCentavos: 100, disponibleCentavos: 0, sinSaldo: true });
});
it('does not flag all-included accounts at zero balance', () => {
  expect(
    workspaceWalletSummary(
      { saldo_centavos: 0 },
      { estado: 'activa', modelo_cobro: 'oficial' },
    ),
  ).toMatchObject({ bloqueaSinSaldo: false, sinSaldo: false });
});
it('keeps the ledger amount and currency identical to the merchant wallet', () => {
  expect(workspaceWalletSummary({ saldo_centavos: '897', reservado_centavos: '20', moneda: 'usd' }, null))
    .toMatchObject({ saldoCentavos: 897, disponibleCentavos: 877, moneda: 'usd', sinSaldo: false });
});
