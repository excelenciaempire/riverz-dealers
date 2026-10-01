# Avisos voluntarios por dispositivo

Avisos de menciones, recordatorios y casos reabiertos, dentro del control actual de instalación en Ajustes. Nacen ocultos fuera de comparación. No sustituyen la campana de Riverz ni notifican o deciden pagos o reembolsos.

## Configuración

1. Configurar en el servicio vigente de Render `BROWSER_PUSH_VAPID_PUBLIC_KEY` y `BROWSER_PUSH_VAPID_PRIVATE_KEY`, un par P-256 estable generado mediante `web-push.generateVAPIDKeys()`. La API verifica que ambas claves correspondan; solo devuelve la pública. Rotar el par requiere desactivar y registrar nuevamente cada dispositivo. No colocar la clave privada en variables `NEXT_PUBLIC_*`, logs o documentos.
2. Aplicar la migración 350 antes del código. El build verifica únicamente catálogos privados, sin leer suscripciones o avisos.
3. La comparación habilita el control y el job propio; no se activa el flag de producción antes de la comparación acordada. Con flag o claves ausentes el endpoint de cron devuelve deshabilitado sin consultar suscripciones, heartbeat o proveedores.
4. En el dispositivo, abrir Ajustes → instalación → avisos y pulsar activar. La solicitud de permiso solo ocurre en el clic. Si registrar el dispositivo falla, una suscripción recién creada se revierte; una anterior permanece intacta. La aceptación del permiso por sí sola no se presenta como instalación ni entrega.

## Alcance y privacidad

- Tres proveedores de navegador soportados por destino fijo: FCM, Mozilla y Apple. HTTPS, DNS público fijado, TLS verificado, sin redirecciones y corte de ocho segundos. Otros endpoints quedan rechazados; no se promete compatibilidad universal. La biblioteca cifra y firma localmente; no controla la conexión.
- Un endpoint físico pertenece a un actor real y un negocio seleccionado. No puede reasignarse a otro usuario; el mismo usuario puede moverlo a otro negocio permitido. Máximo cinco registros activos por usuario, con serialización para impedir que solicitudes simultáneas salten el límite. Renovación voluntaria a treinta días. El cifrado liga endpoint, actor, negocio y hash; no se aceptan paquetes copiados entre ámbitos.
- Solo se encolan nuevos avisos posteriores al registro. Envíos vencen a diez minutos y TTL del proveedor es diez minutos. No hay envío retrospectivo. La cola vuelve a verificar usuario, permisos actuales de Bandeja, conversación, negocio y propiedad del buzón privado. Desactivar o vencer elimina las credenciales almacenadas. Los metadatos de comprobantes permanecen privados; no se cambia la retención general de registros del CRM.
- Texto neutro en la pantalla bloqueada, sin nombres, contenido de notas, mensajes, pedido, importe ni secretos. El payload cifrado solo contiene clase de aviso, idioma e identificador de caso. Abrirlo utiliza una ruta fija del mismo origen; requiere autenticación y acceso actual al caso. Si el negocio seleccionado cambió, el caso puede requerir seleccionar el negocio correcto.
- Worker únicamente para avisos: no intercepta fetch, no guarda pantallas privadas en caché, no ofrece modificaciones sin conexión. El botón de retiro elimina primero el registro del servidor y después cancela el navegador.

## Ejecución y aceptación

El scheduler propio procesa hasta diez comprobantes por corrida y dos sockets a la vez, bajo leases privados. HTTP 2xx significa aceptación del proveedor, no recepción o lectura. 404/410 retira la credencial. Resultado incierto o pérdida del proceso no se reenvían automáticamente; la campana existente conserva el aviso sin leer. No se ejecuta una decisión comercial al pulsar un aviso.

Las pruebas usan PostgreSQL aislado, claves efímeras, navegadores simulados, cifrado real y sockets simulados. No se enrola al dueño ni se envía a un dispositivo real como QA. La aceptación física en Android/Chrome y en iOS/iPadOS instalado permanece pendiente de consentimiento del dispositivo y configuración efectiva; no se declara resuelta por los tests.

No se consulta un modelo ni se consumen tokens de IA para encolar o enviar avisos. Existen consumo de servidor y red; no se cambia la política de precios.

Referencias: [biblioteca Web Push](https://github.com/web-push-libs/web-push), [Web Push en aplicaciones de pantalla de inicio de iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple: envío Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
