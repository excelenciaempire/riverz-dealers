# Solicitud de acceso a la API de Dropi (integración Riverz)

**Enviar a:** comercial@dropi.co (con copia a soporte vía https://dropi.co/contactanos/)
**Alternativa:** WhatsApp comercial (+57) 321 8379821 para pedir el contacto del equipo técnico/integraciones.

**Contexto investigado (para sostener la conversación técnica):**

- Dropi expone una API de Integraciones que se autentica con el header `dropi-integration-key`; el token se genera desde la sección **Integraciones** del panel del comercio y se asocia a la plataforma que consume.
- Hay ambiente de **pruebas** y de **producción** con URLs base distintas.
- Los servicios documentados incluyen autenticación/login, creación de órdenes y **consulta de guías**, con estados tipo `GUIA_GENERADA`.
- Ya existen integraciones de chat/automatización listadas en dropi.co/integraciones: ChatCenter, Chatea Pro, IaChat, Fluxi, Lucidbot (Dropi V2), Mastertools. Es el mismo casillero que ocuparía Riverz.
- Países con operación: Colombia, México, Ecuador, Panamá, Paraguay, Chile, Perú.

---

## Asunto

Solicitud de acceso a la API de Integraciones — Riverz (CRM con IA para ecommerce COD)

## Cuerpo

Hola, equipo de Dropi:

Soy Juan Diego Ríos, fundador de **Riverz** (riverz.co), una plataforma de ventas y atención con IA que centraliza WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas en un solo lugar. Buena parte de nuestros comercios opera contra entrega en Colombia y el resto de la región, y hoy ya usan Dropi para su logística.

Escribo para solicitar **acceso a la API de Integraciones de Dropi** y, si existe, el alta como integración oficial dentro de su directorio.

**Qué queremos resolver.** Hoy el comercio confirma el pedido en Riverz, lo carga en Dropi y después vuelve manualmente a copiar el número de guía para enviárselo al cliente. Con acceso a la API, ese ciclo queda automático:

1. Al confirmarse un pedido (chat o llamada), Riverz lo crea en Dropi.
2. Cuando Dropi genera la guía, Riverz envía automáticamente al cliente su número de guía, transportadora y enlace de rastreo por WhatsApp.
3. Ante cada cambio de estado o novedad (dirección incompleta, cliente no contesta, reprogramación), el agente de IA contacta al cliente, resuelve y devuelve la información al pedido.

Esto reduce devoluciones y llamadas de soporte, y hace que más pedidos lleguen a entrega efectiva — que es exactamente lo que le conviene a los dos lados.

**Accesos que necesitamos:**

1. **Credenciales y modelo de conexión.** Llave de integración (`dropi-integration-key`) para ambiente de pruebas y producción, y el mecanismo previsto para que **cada comercio conecte su propia cuenta de Dropi** desde Riverz (somos multi-cuenta: un token por comercio, no uno global).
2. **Pedidos.** Crear y actualizar órdenes, y consultar su estado.
3. **Guías.** Número de guía, transportadora, enlace de rastreo, historial de estados y el **catálogo completo de estados** con su significado.
4. **Webhooks.** Notificación de cambios de estado (guía generada, en ruta, entregado, novedad, devolución), con URL configurable por comercio. Si aún no existen, podemos consultar por sondeo, pero preferimos webhooks para no golpear su API.
5. **Novedades, devoluciones y recaudo.** Motivo de la novedad, acciones posibles y valor recaudado del pedido contra entrega.
6. **Maestros.** Catálogo y stock de proveedores, y listado de ciudades/departamentos para normalizar direcciones antes de generar la guía.

**Preguntas operativas:**

- ¿Cuál es la documentación vigente y las URLs base de pruebas y producción?
- ¿Qué límites de consumo (rate limits) aplican y qué SLA maneja el ambiente de pruebas?
- ¿El acceso aplica a las operaciones de Colombia, México, Ecuador, Panamá, Paraguay, Chile y Perú, o se solicita por país?
- ¿Existe un programa de partners o requisitos para aparecer en dropi.co/integraciones?
- ¿Qué requieren de nuestro lado en materia legal (tratamiento de datos personales / Habeas Data, acuerdo de confidencialidad, contrato de integración)? Podemos firmar lo que haga falta.

Quedo atento a una llamada de 20 minutos con su equipo técnico para alinear el alcance y empezar en el ambiente de pruebas. Tenemos el desarrollo listo para conectar apenas nos habiliten las credenciales.

Gracias por el tiempo.

Juan Diego Ríos
Fundador — Riverz
juandiegoriosmesa@gmail.com · riverz.co
