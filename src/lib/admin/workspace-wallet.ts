/** Read-only wallet summary; mirrors the runtime gate without creating wallet accounts. */
export function workspaceWalletSummary(
  account: { saldo_centavos?: number | string; reservado_centavos?: number | string; moneda?: string } | null,
  subscription: { estado?: string } | null,
) {
  const saldoCentavos = Number(account?.saldo_centavos ?? 0);
  const disponibleCentavos = saldoCentavos - Number(account?.reservado_centavos ?? 0);
  const exenta = subscription?.estado === 'cortesia';
  return {
    saldoCentavos,
    disponibleCentavos,
    moneda: account?.moneda ?? 'usd',
    bloqueaSinSaldo: !exenta,
    sinSaldo: !exenta && disponibleCentavos <= 0,
  };
}
