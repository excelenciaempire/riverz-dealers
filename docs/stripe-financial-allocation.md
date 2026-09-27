# Prorrateo de costos financieros — estado de implementación

## Verificado el 27 de septiembre de 2026

- Cuenta Stripe: Rivers Consulting LLC (`acct_1PmcXrL0pSUS73Ad`).
- Retiro `po_1UKPPjL0pSUS73AdmgIfjNgu`: USD 23,10; instantáneo; comisión real USD 0,50, verificada en el Dashboard.
- La recarga de Revitaly por USD 25 ya tiene un descuento histórico de procesamiento de USD 1,40 en el libro del CRM. No debe cobrarse otra vez.
- Los retiros manuales no ofrecen en el Dashboard la conciliación automática de pagos incluidos. La coincidencia de importes no constituye por sí sola una atribución a un comercio.

## Implementado

`src/lib/wallet/financial-allocation.ts` calcula un plan sin escribir movimientos ni descontar saldo:

1. Recibe una comisión real y las participaciones verificadas de los fondos, en centavos USD. No calcula un mínimo por mensaje ni presupone que todos los retiros cuesten 1,5%.
2. Reparte proporcionalmente, con aritmética entera y desempate determinista.
3. Descuenta de cada participación lo ya recuperado de ese mismo recibo y fuente de fondos.
4. Conserva como costo de Riverz las participaciones exentas, los fondos no atribuidos y las fracciones de centavo no asignables.
5. Excluye recibos anteriores al instante explícito de activación. El retiro histórico citado arriba no autoriza un cargo retroactivo.
6. Rechaza monedas, fechas, importes y participaciones inválidos o duplicados.

Diez pruebas automáticas cubren estas reglas. Este cálculo **no está conectado al cobro** y no constituye una activación del Instant Fee.

## Condiciones para conectar el descuento

- Importación verificable de los recibos Stripe y atribución de fondos; sin relación verificada, no cobrar.
- Persistencia de recibos y recuperaciones con unicidad; el cálculo puro no sustituye idempotencia en PostgreSQL.
- Descuento integrado en `wallet_liquidar`, atómico con reserva y movimiento, manteniendo separado el costo original del proveedor.
- Reversión proporcional ante reembolsos/correcciones y protección de exenciones y operaciones iniciadas antes de activar.
- Verificación del despliegue: a las 23:19 UTC, `/api/version` todavía servía `9c23eed1093766c8074a19abb53537e2297bf644`, pese a que `main` ya contenía cambios posteriores. No activar un mecanismo de cobro suponiendo que el código nuevo está en producción.

Fuentes: https://stripe.com/pricing y https://docs.stripe.com/reports/payout-reconciliation.
