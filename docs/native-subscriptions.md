# X5 — suscripciones nativas de Recharge

Proveedor seleccionado: Recharge API 2021-11. El cliente, la autorización durable, la API y los controles privados están implementados. La validación local usa Shopify, Recharge y clientes ficticios; no acredita una instalación real ni una operación de cobro real. La UI pública conserva la bandera de mejoras apagada.

## Experiencia

- Configuración plegada en Ajustes → Canales para el instalador. El negocio conserva su Shopify actual y confirma la correspondencia de la cuenta Recharge; su identificador no se interpreta como un dominio de Shopify. La credencial se cifra en el servidor, nunca aparece en el GET ni en la comparación.
- Control plegado dentro de las herramientas del pedido de Bandeja. Solo una apertura o actualización explícita consulta al proveedor. No hay menú adicional ni sustitución de campañas, plantillas, automatizaciones o funciones actuales.
- Cantidad, frecuencia de entrega/cobro, próxima fecha, cancelación con motivo/comentarios, reactivación y salto de un ítem de entrega existente. La entrega se selecciona por fecha; el usuario no necesita buscar IDs técnicos. Prepagos o ítems no saltables quedan excluidos del salto.
- Revisión del estado anterior y del cambio exacto, seguida de dos confirmaciones humanas. Editar invalida la revisión. Cambiar frecuencia puede recalcular cobros/entregas y skips; reactivar puede programar nuevos cobros. No se inventan importes futuros o ingresos retenidos.

## Cuenta, cliente y permisos

La instalación queda ligada a una conexión Shopify activa y explícita, cuenta Recharge/identificador, workspace y revisión de configuración. Se comprueban `/store` y `/token_information`; los scopes no sustituyen la identidad de tienda. Lecturas: `read_store`, `read_customers`, `read_subscriptions`; cambios de suscripción: `write_subscriptions`; salto de cargo: `read_orders` y `write_orders`.

Un RPC privado verifica conversación, contacto y pedido dentro del workspace, sección de Bandeja y propiedad de los canales personales Gmail/Outlook/Zoho. El servidor consulta el pedido de la conexión Shopify seleccionada y el cliente Shopify actual: únicamente sus datos actuales de contacto se comparan con el contacto del caso. No se usan direcciones de envío ni email antiguo del pedido para demostrar identidad.

Recharge se consulta con `external_customer_id=<ID numérico verificado de Shopify>`. Se exige una coincidencia exacta y única de `external_customer_id.ecommerce`; no se adivinan equivalencias por email, teléfono, nombre o GID. Se revalida la tupla cliente/suscripción/dirección. Paginación por cursor, 50 filas por petición y diez páginas como límite local; agotar el límite produce error, nunca una lista silenciosamente incompleta.

## Ejecución y recuperación

El hash de revisión incluye instalación, contexto vigente del caso, cliente Shopify, estado actual, cambio exacto y, para saltar una entrega, cargo y entrega observados. Un intento se guarda antes de comprobar de nuevo el estado externo. Un nonce reclama una sola ejecución tras verificar actor, permiso de sección, canal personal, billing vigente, Shopify activo, revisión, contexto/pedido/contacto sin cambiar, snapshot y límite diario UTC.

Cada transporte usa origen fijo, timeout de ocho segundos, JSON limitado a 512 KB, sin redirects ni retries. Se envía una sola escritura de proveedor. `cancel` solicita explícitamente `send_email:false`; no se afirma que esto desactive otras automatizaciones de Recharge. No hay generación automática con IA ni cambios al pricing o al saldo de Riverz.

Los comprobantes separan revisión, ejecución en curso, aceptación del proveedor, estado deseado observado, incertidumbre y cierre anterior a la ejecución. Un GET posterior prueba el estado observado, sin acreditar causalidad. HTTP 200 o `updated_at` por sí solos no prueban el resultado. Un cargo globalmente saltado no demuestra el salto de un ítem: se compara la línea exacta en `deliverySchedule` y se conservan los estados de los demás ítems del cargo.

Un POST sin respuesta conserva el bloqueo incluso si una lectura posterior muestra el estado solicitado. Solo aceptación conocida más lectura compatible permite otra operación distinta, nuevamente revisada. No se libera una ejecución en curso mediante una lectura concurrente. Los intentos quedan conservados aunque se borre el cache del caso.

El navegador guarda únicamente IDs del intento/caso antes de ejecutar. Doble clic, remount o fallo de persistencia no permiten otro envío. Un 404 de comprobante no prueba que la petición original no pueda llegar tarde: el cierre de un intento ausente crea una marca durable que rechaza ese ID. Un intento reclamado nunca se convierte en una cancelación local o una oportunidad de repetirlo.

## Privacidad y límites

La migración 374 añade cuatro tablas con RLS y dieciocho funciones privadas con `search_path` fijo. Los roles de navegador y el acceso directo de `service_role` a tablas están revocados; los datos se leen mediante RPC con autorización vigente. Se almacenan proyecciones de suscripción/entrega y trazabilidad, no clientes completos ni datos de contacto de Shopify/Recharge. El contexto temporal con contacto se valida y no se devuelve a la UI ni se registra en los comprobantes.

El cron de retención conserva incertidumbre de ejecuciones reclamadas y elimina instalaciones/marcas de tenants borrados tras la gracia. La migración y su comprobación real consultaron únicamente metadatos/actor nulo; no se ejecutó una purga como QA. El hard delete de Shopify/instalación elimina su historial por cascada; una nueva instalación requiere comprobar la cuenta y su estado real, sin prometer deduplicación perpetua entre instalaciones.

Recharge no ofrece en este contrato idempotencia o escritura condicionada al snapshot observado: existe una ventana entre la última lectura y la escritura externa. Riverz comprueba su autoridad inmediatamente antes de enviar y trata los resultados no demostrados de forma conservadora; no declara atomicidad externa. Variantes, descuentos, reintentos de cargos, futuros skips por dirección y otros proveedores Loop/Skio no se acreditan como construidos por este conector.

Contrato y fuentes primarias: [subscriptions-recharge-contract.md](subscriptions-recharge-contract.md). Pruebas y cierre de comparación/despliegue se registran en el ledger de ejecución y en la evidencia de QA; este documento no sustituye esos resultados.
