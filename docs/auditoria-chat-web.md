# Auditoría del chat web

Fecha: 6 de septiembre de 2026

## Veredicto

El chat web está listo para operar en tiendas ya conectadas y para instalación manual. El canal cubre conversación, venta y seguimiento; no es un prototipo. Sin embargo, todavía no está listo para escalar como app pública de Shopify porque la instalación automática usa `ScriptTag`, una API en retirada.

Shopify impedirá crear o actualizar ScriptTags desde el 1 de octubre de 2026 y dejará de inyectarlos en tiendas desde el 1 de marzo de 2027. La ruta definitiva es un **app embed block** dentro de una **Theme App Extension**. Shopify exige este modelo para apps que modifican el storefront y se distribuyen en su App Store.

Fuentes oficiales:

- [ScriptTag resource (legacy)](https://shopify.dev/docs/apps/build/online-store/script-tag-legacy)
- [Theme app extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions)
- [Configuración y deep links de app embeds](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)
- [UX recomendada para theme app extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux)

## Funcionalidad disponible

| Área                | Estado              | Alcance comprobado en código                                                                                                                                        |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalación         | Operativa con deuda | Snippet manual y botón automático para Shopify mediante ScriptTag.                                                                                                  |
| Seguridad           | Completa            | Dominio autorizado, token de instalación firmado, sesión con vencimiento, prueba de identidad del visitante, rate limit y aislamiento de archivos por conversación. |
| Conversación        | Completa            | Historial, polling incremental, mensajes optimistas, reintento, no leídos, sonido, persistencia entre páginas y renovación de sesión.                               |
| Atención con IA     | Completa            | Selección de agente, detección de agente pausado, horario, mensaje fuera de horario y traspaso explícito a una persona.                                             |
| Captura de contacto | Completa            | Ningún dato, correo, teléfono o ambos; evita fusionar identidades no verificadas.                                                                                   |
| Archivos            | Completa            | Imágenes y PDF, límite de 10 MB, validación del tipo real y proxy privado de lectura.                                                                               |
| Catálogo            | Completa            | Contexto de la página visitada, ficha de producto, variantes, disponibilidad y precios vivos.                                                                       |
| Conversión          | Completa            | Agregar al carrito, ir al pago, descuentos, carrito con varios productos y soporte para Shopify, Tiendanube y WooCommerce.                                          |
| Atribución          | Completa            | Identificador en carrito/pedido, Contact, AddToCart, InitiateCheckout y Purchase por Meta CAPI con deduplicación del píxel.                                         |
| Calidad             | Completa            | Calificación útil/no útil, comentario y métricas de resolución, satisfacción y primera respuesta.                                                                   |
| Configuración       | Completa            | Marca, avatar, color, posición, saludo, preguntas sugeridas, archivos, datos requeridos e invitación por tiempo, scroll, salida y URL.                              |
| Idiomas             | Completa            | Panel en español e inglés; interfaz del visitante sigue el idioma del agente o del navegador.                                                                       |
| Vista previa        | Completa            | Simulación visual y prueba real contra el mismo agente, con conversación visible en la bandeja.                                                                     |

## Estado de la app de Shopify

No hace falta empezar una app desde cero. El repositorio ya tiene las piezas difíciles del ciclo de instalación:

- OAuth iniciado desde Riverz y desde Shopify.
- Instalación pendiente para un comercio que todavía no tiene cuenta en Riverz.
- Vinculación de la tienda después de crear o iniciar sesión.
- App embebida en Shopify Admin con App Bridge y session token.
- Renovación de tokens, desinstalación, webhooks, catálogo, clientes, pedidos, carritos y borradores.
- Conexión alternativa por credenciales de desarrollo y por token de custom app.

La pieza que falta es la extensión del storefront. Por eso conviene completar la app existente con un app embed, no crear otra integración paralela ni pedir credenciales al comercio.

## Qué falta

### P0 — migrar Shopify a app embed

La migración debe terminar antes del 1 de octubre de 2026 para no perder nuevas instalaciones automáticas.

1. Crear una Theme App Extension en el proyecto de la app pública de Shopify.
2. Añadir un app embed block con `target: body` que cargue `widget/v1.js`.
3. Resolver la cuenta sin pedir al comercio una llave manual. La opción recomendada es guardar la llave en un app-data metafield durante OAuth y leerla como `app.metafields.riverz.widget_key` desde Liquid.
4. Después de OAuth, llevar al comercio al editor del tema con el deep link oficial `activateAppId={api_key}/{handle}`.
5. Detectar la activación con `shopify.app.extensions()` dentro de la app embebida y mostrar un único estado: pendiente, activo o requiere acción.
6. Mantener ScriptTag sólo como transición para instalaciones existentes y retirarlo antes de marzo de 2027.

### P1 — convertir instalación y activación en un solo recorrido

Hoy “instalar”, “agregar dominio” y “activar” son acciones separadas. El panel ya muestra el motivo cuando falta una, pero el ideal para Shopify es:

1. Instalar Riverz desde Shopify.
2. Crear o vincular la cuenta de Riverz.
3. Abrir el theme editor con el chat preactivado.
4. Volver a Riverz con dominio detectado, agente elegido y prueba disponible.

La pantalla debe conservar la instalación manual sólo para sitios sin integración nativa.

### P1 — prueba end-to-end de storefront

Las pruebas unitarias cubren seguridad, enlaces, carritos y estadísticas. Falta una prueba de navegador estable que monte una tienda de ejemplo y valide: carga del launcher, apertura, envío, respuesta, producto, carrito, cierre, recarga y reanudación. Esta prueba debe correr en escritorio y móvil.

### P2 — operación y diagnóstico

- Registrar una señal de salud por dominio: última sesión correcta, último error y versión del loader.
- Alertar cuando el código está instalado pero no se ha abierto ninguna sesión después de publicar.
- Medir el embudo de activación: conectó tienda → activó embed → encendió chat → primera conversación → primera venta.
- Mostrar rendimiento del widget: peso del loader, tiempo hasta launcher y errores de sesión.

### P2 — experiencia del comercio

- Mantener la vista previa lateral y las cuatro secciones: la estructura actual es clara.
- Usar el resumen de preparación como navegación directa a lo pendiente.
- Mostrar estados del app embed, no detalles de permisos ni código, en el camino Shopify.
- Evitar sumar más opciones visuales hasta tener evidencia de uso; el mayor riesgo actual no es la personalización, sino una instalación incompleta.

## Cambios aplicados durante la auditoría

- Resumen visible de preparación: dominio, agente y activación.
- Cada pendiente abre directamente la sección donde se resuelve.
- Cuando Shopify requiere permisos, aparece una acción real para reconectarlo en Integraciones.
- Los errores de instalación se traducen en el cliente mediante códigos estables.
- La tarjeta de Shopify tiene un ancla directa para que el recorrido no deje al usuario arriba de una grilla extensa.
- Se corrigieron advertencias de accesibilidad de los botones que renderizan enlaces.

## Criterio de “listo”

El chat web queda listo para escala cuando se cumplan simultáneamente estas condiciones:

- La app pública instala un app embed, no un ScriptTag.
- El estado de activación se puede comprobar desde Riverz.
- Una tienda nueva llega a una conversación real sin copiar código ni pegar credenciales.
- El recorrido completo pasa una prueba automática en escritorio y móvil.
- Riverz puede distinguir “apagado”, “sin instalar”, “embed desactivado”, “dominio rechazado” y “agente sin atender”.
