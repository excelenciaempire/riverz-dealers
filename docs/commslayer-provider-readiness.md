# Preparación de integraciones y límites de aceptación

Comprobación del 2 de octubre de 2026, 04:48 UTC. Documento interno del [plan Commslayer](plan-final-mejoras-riverz-commslayer.md). No anuncia disponibilidad general.

## Entrega verificada

Render publicó `2d1b62a88ccc0b1246e24a920b52ab5095a1c906` mediante `dep-davjb9dckfvc73br88h0`, terminado a las 04:46:08 UTC. `/api/health` respondió HTTP 200 a las 04:47:59 UTC con la revisión exacta, servicio, Supabase y WhatsApp `ok`. La variable `NEXT_PUBLIC_RIVERZ_UI_STAGE` continúa sin configurar. Los materiales y controles nuevos siguen reservados para la comparación local.

La salud comprueba conectividad del servicio; no acredita una llamada, importación, entrega de notificación o acción comercial con un proveedor.

## Avisos de navegador

El par estable `BROWSER_PUSH_VAPID_PUBLIC_KEY` / `BROWSER_PUSH_VAPID_PRIVATE_KEY` se guardó en el servicio vigente de Render a las 04:43 UTC. La lectura de configuración de las 04:48 UTC comprobó presencia y correspondencia P-256; no hay grupos de entorno vinculados. Las claves privadas no se incluyen en el repositorio, informes ni salida de diagnóstico. Se usaron actualizaciones individuales, sin reemplazar el conjunto de variables.

Guardar las variables no prueba que un despliegue iniciado anteriormente las haya incorporado. El siguiente despliegue posterior a su guardado permite cargar la configuración; la entrega física sigue necesitando registro voluntario y permiso del dispositivo. No se registró un dispositivo ni se contactó FCM, Mozilla o Apple como QA.

Con el flag apagado, tanto la ruta cron como el despachador devuelven deshabilitado antes de consultar o reclamar avisos. Configurar el par no activa envíos, suscripciones ni decisiones comerciales. [Contrato completo](browser-push-notices.md).

Referencias operativas: [Render: actualización individual](https://api-docs.render.com/reference/update-env-var), [Render: configuración y despliegue de variables](https://render.com/docs/configure-environment-variables). El par se conserva entre despliegues; no se regenera al compilar ni por dispositivo.

## Fuentes de Drive

La configuración de Render contiene el par general de OAuth de Google que el proveedor de Riverz admite como fallback. No contiene un par específico de Drive. Esto no demuestra Drive API habilitada, redirect registrado, aprobación del scope restringido, consentimiento o lectura de un archivo. Tampoco demuestra un fallo de la integración Gmail existente.

La integración implementada selecciona archivos explícitos, guarda tokens cifrados, revisa fuentes antes de usarlas y conserva aprobación humana del texto. La importación y sincronización no llaman modelos. La aceptación con una cuenta real permanece separada de los parsers y OAuth aislados ya validados. [Configuración y límites](drive-document-sources.md).

## Distribución de Shopify

`shopify app info --config public --json` terminó correctamente en modo no interactivo. Se inspeccionaron únicamente nombres de campos; no se imprimieron tokens, clientes o tiendas. El resultado acredita que la CLI puede leer la configuración de la app: no contiene un estado de aprobación de distribución o revisión de App Store. No se ejecutó `--reset`, `--web-env`, login, instalación o cambio de distribución.

Los permisos y versiones publicados anteriormente se conservan con su evidencia por entrega. Una versión de configuración publicada no concede nuevos scopes a tokens ya instalados ni acredita distribución. La verificación de distribución corresponde al Dev Dashboard y al estado de revisión de la app; no se declara aprobada ni rechazada por la ausencia de una ficha en una búsqueda pública.

Referencias: [Shopify: elegir distribución](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method), [Shopify: proceso de revisión](https://shopify.dev/docs/apps/launch/app-store-review/review-process), [Shopify: datos protegidos](https://shopify.dev/docs/apps/launch/protected-customer-data).

## Paquetes posteriores

La sección 9 distingue X1–X5 de la entrega central y condiciona proveedores, acceso y presupuesto. La revisión inicial confirma que CSV ya existe: separadores, mapeo ES/EN, vista previa, lectura paginada de identidades y deduplicación por negocio. No se presenta como ausente ni como migración completa de historiales/adjuntos desde terceros.

La documentación de Kommo acredita entidades y API, con paginación de hasta 250 y límite de siete solicitudes por segundo. No acredita acceso a una cuenta o permiso para extraerla. Recharge documenta consulta de suscripciones y scopes diferenciados; cambios pueden tener efectos de cobro o comunicación. No se eligió un proveedor de suscripciones, creó una cuenta ni ejecutó una cancelación para validar el plan.

Fuentes: [Kommo: límites de API](https://developers.kommo.com/docs/limitations), [Recharge: API de suscripciones](https://developer.rechargepayments.com/2021-11/subscriptions). Esta comprobación inicial de factibilidad no constituye construcción o aceptación de X2/X5, y no acredita X1/X3/X4.

## Evidencia que no se sustituye con fixtures

| Capacidad | Evidencia ya disponible | Evidencia externa no acreditada |
| --- | --- | --- |
| Avisos móviles | Código, SQL, cifrado, permisos, claves correspondientes y pruebas aisladas | Permiso/registro y recepción física por plataforma |
| Drive | OAuth, parsers Linux, versiones, permisos y retirada aislados | API/scopes aprobados, consentimiento y ciclo de archivo real |
| Shopify | Configuración/versions publicadas y guards de scopes actuales | Estado de distribución y revisión en Dev Dashboard |
| Logística de devoluciones | Expediente, guía/recepción declaradas y comprobantes | Etiqueta automática o aceptación física de una transportadora |
| HTTP personalizado | Guard, configuración, recibos y ejecución aislada | Cumplimiento comercial del sistema destinatario |

Ninguna de estas condiciones se transforma en éxito por un build, una respuesta HTTP 2xx o datos ficticios. La revisión privada permite comparar el producto sin escribir en clientes, enviar mensajes, cambiar pedidos o mover fondos.
