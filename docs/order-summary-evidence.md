# Importes de pedidos del resumen

`metricas.resumen` conserva sus campos y añade desglose por moneda, exclusiones y período anterior. Solo suma pedidos cuyo espejo guarda `financial_status = paid` y un estado de pedido `created`, `paid` o `fulfilled`. Un pago reportado por el cliente, una autorización, un cobro parcial o un pedido reembolsado no califican.

Los importes representan **totales de pedidos guardados como pagados**, agrupados por fecha de creación del pedido. No representan caja neta, fecha de cobro, importe de transacciones, ventas atribuibles a Riverz ni una consulta en vivo al proveedor. Los estados pueden cambiar después del período y el espejo puede estar desactualizado.

`por_moneda[].importe` utiliza el cálculo decimal compartido con reembolsos, hasta seis decimales. Nunca se convierte entre monedas. El campo compatible `facturado` solo contiene un número si existe una moneda, todos los pedidos calificados tienen datos utilizables y el número conserva exactamente la suma. Ausencia, mezcla o evidencia incompleta producen `null`; un cero observado conserva `0`. `importes_no_disponibles` identifica pedidos pagados excluidos del importe por falta de evidencia. `excluidos` identifica pedidos que no califican por sus estados.

Las consultas auxiliares de IA y pedidos paginan con orden estable, incluyen el límite superior exclusivo y fallan ante errores o respuestas ausentes. Un límite de seguridad agotado no devuelve un total parcial. Se usa la zona del negocio para la ventana de días calendario y se entrega el período anterior equivalente. Los cierres de la base se identifican expresamente como distintos de las resoluciones verificadas.

La prueba utiliza pedidos y consultas simulados. No crea pedidos, cobros, devoluciones ni llamadas a modelos. No cambia precios, facturación o navegación.
