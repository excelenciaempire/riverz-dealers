# X5 — contrato verificado de Recharge

Investigación pública realizada por el subagente autorizado con Firecrawl el 2 de octubre de 2026. Primer proveedor seleccionado: Recharge API **2021-11**. Este documento fija el contrato de implementación; no declara todavía construido, conectado o probado el conector ni una cuenta real.

## Cuenta y vínculo con el negocio

Origen fijo `https://api.rechargeapps.com`; headers `X-Recharge-Access-Token` y `X-Recharge-Version: 2021-11`. `GET /store` con `read_store` devuelve `{store:{id, external_platform, identifier,...}}`. `identifier` se documenta como identificador único de plataforma externa, con ejemplo `store-id`: **no demuestra por sí mismo un dominio myshopify.com o ID de Shopify**. No se construye un matcher que invente esa equivalencia.

La instalación debe ligar explícitamente la conexión vigente de Shopify, cuenta Recharge e identificador esperado mediante una correspondencia confiable revisada por el instalador. Sin esa correspondencia no se habilitan cambios. `GET /token_information` permite verificar scopes pero no acredita la tienda. Mantener credencial cifrada privada, cuenta exclusiva por tenant, revisión de instalación y comprobación actual de la conexión antes de leer/modificar.

## Lectura

| Recurso | Ruta / scope | Contrato |
| --- | --- | --- |
| Clientes | `GET /customers`, `/customers/<id>` / `read_customers` | Raíces `customers` / `customer`; ID entero de Recharge, `external_customer_id.ecommerce` string. Vincular solo al cliente identificado de la tienda actual; no por parecido de nombre o email. |
| Suscripciones | `GET /subscriptions`, `/subscriptions/<id>` / `read_subscriptions` | Raíces `subscriptions` / `subscription`; ID, customer_id y address_id enteros. Precio string, producto/variante externos string, estados active/cancelled/expired, siguiente fecha y cadencia. |
| Entregas | `GET /customers/<id>/delivery_schedule` / `read_customers` | Raíz camelCase `deliverySchedule`; cliente y entregas con fecha, address_id, charge_id y line_items con subscription_id/is_skipped/is_skippable/is_prepaid. Horizonte documentado de hasta 365 días. |

Paginación por `next_cursor`/`previous_cursor` opacos; máximo 250 filas, 50 por defecto. No reutilizar ejemplos antiguos de `page` o `page_info`. Validar continuidad, IDs, duplicados y límites; un recorrido incompleto no equivale a «sin suscripciones». Proyectar campos útiles, no copiar clientes completos a registros o herramientas del asistente.

## Cambios revisados

| Acción | Ruta / scope | Datos y comprobación |
| --- | --- | --- |
| Cantidad, variante, cadencia | `PUT /subscriptions/<id>` / `write_subscriptions` | Revisión de valor anterior/nuevo. Para cadencia enviar juntos unit, order_interval_frequency y charge_interval_frequency; puede recalcular fecha y quitar skips manuales. |
| Cancelar | `POST /subscriptions/<id>/cancel` / `write_subscriptions` | `cancellation_reason` obligatorio; comentarios hasta 1024 caracteres; `send_email:false` explícito. Requiere aprobación vigente y trazabilidad. |
| Reactivar | `POST /subscriptions/<id>/activate` / `write_subscriptions` | Body `{}`; nueva aprobación. No deducir reactivación de HTTP 200. |
| Próxima fecha | `POST /subscriptions/<id>/set_next_charge_date` / `write_subscriptions` | `{date:'YYYY-MM-DD'}`. La ruta no es `change_next_charge_date`. Fechas coincidentes en la misma dirección pueden fusionar cargos/cambiar su ID. |
| Saltar ítem de cargo existente | `POST /charges/<id>/skip` / `write_orders` | `{purchase_item_ids:[subscriptionId]}`; comprobar que la línea pertenece a esa suscripción y dirección. No saltar todas las líneas de un cargo multiítem. |

Las mutaciones devuelven una suscripción con HTTP 200, pero algunos ejemplos oficiales contradicen el estado/cantidad solicitados. Validar la identidad y hacer GET de estado actual: separar aceptación de cambio observado. `updated_at` no prueba por sí mismo una modificación de fecha derivada. No se atribuye ingreso retenido a una oferta o clic sin evidencia del resultado.

Los ejemplos de «skip futuro por dirección» contradicen `subscription_ids` y `purchase_item_ids`; no se implementa una equivalencia inventada. Se usa el cargo existente y el delivery_schedule para observar el ítem saltado y preservar los demás. Las guías también contradicen nombres de scopes de cargos y `commit`/`commit_update`: usar el endpoint/version fijados, no mezclar contratos.

Toda escritura necesita intento durable ligado al actor/negocio/cuenta/cliente/suscripción, revisión exacta del estado y confirmación literal. Un resultado incierto no autoriza repetir el POST. Una lectura posterior solo acredita el estado observado, no la causalidad de nuestra operación. La validación local usa transportes y base ficticios; no cancela, reactiva, cambia fechas, envía correo ni toca cargos reales.

## Fuentes primarias

- [Referencia 2021-11: tienda, token, clientes y suscripciones](https://developer.rechargepayments.com/2021-11/subscriptions).
- [Actualizar suscripción](https://developer.rechargepayments.com/2021-11/subscriptions#subscriptions_update).
- [Cancelar](https://developer.rechargepayments.com/2021-11/subscriptions#subscriptions_cancel).
- [Activar](https://developer.rechargepayments.com/2021-11/subscriptions#subscriptions_activate).
- [Cambiar fecha](https://developer.rechargepayments.com/2021-11/subscriptions#subscriptions_change_next_charge).
- [Skip de cargo](https://developer.rechargepayments.com/2021-11/charges/charge_skip).
- [Delivery schedule](https://developer.rechargepayments.com/2021-11/subscriptions#customer_delivery_schedule).
- [Paginación por cursor](https://docs.getrecharge.com/docs/using-cursor-pagination-with-the-recharge-api).
- [Referencia de cursor](https://developer.rechargepayments.com/2021-11/cursor_pagination).
- [Estándares de API](https://docs.getrecharge.com/docs/api-standards).
- [Guía de suscripciones](https://docs.getrecharge.com/docs/subscriptions).
