# Costos financieros integrados

## Fuentes y alcance

Cuenta verificada: Rivers Consulting LLC, acct_1PmcXrL0pSUS73Ad, Estados Unidos, USD. Se importan las comisiones reales del libro de Stripe, no un porcentaje supuesto ni un mínimo por mensaje.

El retiro histórico po_1UKPPjL0pSUS73AdmgIfjNgu costó USD 0,50: gasto interno, no cargo nuevo. La recarga histórica de Revitaly de USD 25 ya pagó USD 1,40; no se vuelve a recuperar.

Solo se recuperan recibos y recargas posteriores a wallet_financial_config.activated_at, en operaciones iniciadas después de esa fecha.

## Conciliación

wallet-financial-costs se ejecuta cada 15 minutos, separado del envío de mensajes. Solo lee Stripe: no crea pagos, reembolsos ni retiros.

Procesamiento: verifica pago, comercio, moneda, importe, recarga acreditada y recibo. Excluye comisiones ya descontadas, cortesías, planes con uso incluido y fuentes reembolsadas.

Instant Payouts: Stripe no identifica los pagos constitutivos de un retiro manual. Riverz usa un **prorrateo contable**, no una asociación declarada por Stripe: fondos nuevos verificados desde el retiro anterior, ponderados contra todos los fondos positivos del intervalo y su saldo inicial. Se reconstruye el saldo inicial usando el saldo actual y todos los movimientos posteriores. Los fondos anteriores o ajenos permanecen en el denominador; Riverz absorbe su parte, las fracciones no asignables y los retiros simultáneos ambiguos. Si cambia el saldo durante la lectura, se reintenta sin importar una atribución incompleta. Superar 10.000 movimientos por intervalo exige revisión y no genera cargos supuestos.

Recibo y asignaciones se guardan juntos, una vez por transacción. Nunca se reparte más que la comisión real.

## Liquidación

- El gasto se amortiza dentro de futuros consumos, sin línea separada en la billetera.
- Por tipo de comisión se usa primero la asignación más antigua, a la tasa comisión/fondos netos, limitada al 5% del costo del proveedor por tipo. El tope retrasa la recuperación de comisiones altas; no agrega margen permanente. Al agotar el importe real, deja de recuperarse.
- Reserva, liquidación, recuperación y movimiento son atómicos. Se conserva intacto el costo original del proveedor y el componente financiero queda separado internamente.
- Solo se usan asignaciones conocidas al iniciar la operación; una importación no cambia reservas anteriores.
- Los reintentos no duplican cargos. Corregir a la baja devuelve proporcionalmente el componente financiero, incluso con el interruptor apagado.
- Un ajuste/reembolso de recarga suspende recuperaciones pendientes de esa fuente. No se devuelve una comisión que Stripe no haya devuelto.
- Los gastos de procesamiento con débito cero y los de retiros se incluyen en costos internos sin duplicarlos. La consulta agregada evita truncamientos por límites de filas.

## Activación y reversibilidad

La migración 294 nace desactivada. Se publica y valida el código antes de fijar la fecha y activar. Desactivar wallet_financial_config.enabled detiene nuevas recuperaciones sin borrar evidencia ni bloquear devoluciones. No modificar la fecha para recuperar gastos históricos.

Pruebas: PostgreSQL local con PGlite, atomicidad, reservas, duplicados concurrentes, correcciones, exenciones, topes, reembolsos, gastos históricos y conciliación Stripe simulada. Validación de producción sin cargos de prueba permanentes.

Fuentes: [conciliación de retiros](https://docs.stripe.com/reports/payout-reconciliation), [movimientos de saldo](https://docs.stripe.com/api/balance_transactions/list).
