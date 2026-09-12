# Riverz: robustez, Operador y seguridad — 12 de septiembre de 2026

## Resultado y alcance

Revisión del código, pruebas automatizadas, configuración real de los 12 comercios activos, permisos efectivos de PostgreSQL y respuestas HTTP sin autenticación. Complementa `riverz-audit-2026-09-12.md`, que documenta la sincronización del administrador y la cobertura por funcionalidad.

Se encontraron y corrigieron problemas reales de autorización, concurrencia y validación. Esto no constituye una certificación de ausencia de bugs, una prueba de todas las combinaciones posibles ni una garantía de que la plataforma sea «inhackeable».

## Seguridad: hallazgos y correcciones

| Prioridad | Hallazgo confirmado | Corrección y evidencia |
| --- | --- | --- |
| Crítica | Ocho tablas internas tenían RLS desactivado y permisos para roles de navegador: planes, pasos, consumo y ejecuciones de Operador; planes, suscripciones y consumo de facturación; acceso de soporte. | Migración 259: activa RLS, revoca acceso público y conserva `service_role`. Las ocho consultas HTTP anónimas devuelven 401. Prueba SQL de permisos y acceso legítimo. |
| Crítica | Seis funciones internas podían ejecutarse con roles de navegador, incluidas modificaciones de saldo y asignación de capacidad de llamadas. | Migración 259: revoca ejecución de `PUBLIC`, `anon` y `authenticated`, conserva servidor. La auditoría posterior detecta cero funciones privilegiadas expuestas entre las verificadas. No se alteraron saldos para probarlo. |
| Alta | La política «Service role can insert messages» permitía realmente INSERT a PUBLIC con condición verdadera. | Migración 261: elimina la política. Prueba SQL rechaza inserciones anónimas y de otro comercio, permite usuario autorizado y servidor. |
| Alta | Chat web aceptaba un agente sin comprobar que perteneciera al comercio; campañas de llamadas aceptaban agentes y segmentos sin ese filtro. | Servicios compartidos comprueban pertenencia; rechazan agentes eliminados. Pruebas de aislamiento y ausencia de escritura al rechazar. |
| Alta | Dependencias con vulnerabilidades conocidas, incluida Next.js. El análisis inicial reportó 28 hallazgos: 1 crítico, 4 altos, 22 moderados y 1 bajo. | Actualización de Next.js/eslint-config-next, Sharp, Sentry y dependencias transitivas. `npm audit` final: cero vulnerabilidades conocidas. Compilación y pruebas verificadas. |

Las migraciones 259, 260 y 261 se aplicaron a Supabase. La inspección posterior devuelve cero tablas públicas sin RLS y cero políticas de escritura incondicional para roles de navegador. Esto no demuestra que todas las condiciones de todas las políticas sean correctas: se revisaron además las políticas de membresía, comercio, agentes, conexiones, llamadas y saldo.

Avisos oficiales que motivaron la actualización de Next.js: [GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) y [GHSA-2xp9-vwfh-vxw4](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4).

## Robustez y facilidad de uso

- **Chat web:** pantalla y Operador usan el mismo servicio de configuración. Los cambios parciales se fusionan atómicamente en PostgreSQL; una prueba de 100 solicitudes concurrentes conserva los 100 campos y una única conexión. Sin esta corrección, dos guardados podían sobrescribirse. El ajuste antiguo de pedir correo se sincroniza con el nuevo selector de contacto. Los errores de lectura ya no se interpretan como conexión inexistente.
- **Campañas de llamadas:** validación de entrada, comprobación de comercio y rechazo de cambios sobre campañas inexistentes o terminadas. Una campaña pausada/cancelada durante una ejecución no vuelve a quedar activa por el guardado del progreso. El segmento también se filtra por comercio en el ejecutor.
- **Duplicados de llamadas:** una campaña con guion manual conserva su identidad para deduplicación. Las llamadas de una campaña se protegen aunque el intervalo general de deduplicación esté apagado. Cada reintento usa la identidad de su llamada padre para no confundirse con la llamada original.
- **Suscripciones:** una inicialización concurrente no sobrescribe una suscripción ya creada. Los fallos al leer o crear dejan de confundirse con una cuenta sin suscripción.
- **Zoho:** se incluye en los canales que Operador puede desconectar con aprobación, igual que los demás correos compatibles.

## Operador

Se añadieron cuatro capacidades generales: consultar y configurar el chat web; crear un borrador de campaña de llamadas; iniciar, pausar o cancelar una campaña. Los borradores no llaman. La activación requiere aprobación y muestra el efecto sobre llamadas y saldo; pausar/cancelar advierte que las llamadas ya en cola pueden continuar.

El registro común distribuye automáticamente las capacidades generales a los comercios. Los permisos administrativos siguen aplicándose al chat web. Las tres recetas específicas de Rasmiaw conservan su restricción de marca: no se copiaron sus mensajes ni decisiones comerciales a Pilar u otras cuentas.

No se afirma que Operador pueda realizar cualquier acción concebible. Autorizar cuentas externas por OAuth, superar verificaciones del proveedor, añadir medios de pago o reactivar una cuenta externa inactiva siguen requiriendo intervención humana. Tampoco se ejecutaron mensajes ni llamadas reales como prueba.

## Comparación de cuentas

Instantánea de configuración e historial registrado; los contadores no equivalen a ventas o mensajes entregados.

| Cuenta | Atención configurada | Automatizaciones activas | Diferencias relevantes |
| --- | --- | --- | --- |
| Pilar | Asesora de Pilar y agente llamado «test», ambos activos; WhatsApp, Instagram, Messenger, comentarios, Outlook, TikTok, chat web y voz registrados como conectados. | Carrito abandonado (434 ejecuciones), pago rechazado (2), nuevo pedido (612), tracking (563). | 4.733 contactos y 2.335 conversaciones. Varias conexiones históricas desconectadas no implican que el canal actual esté caído. Mercado Libre permanece en error por cuenta inactiva. Conviene revisar el propósito del agente «test» antes de apagarlo o cambiarlo. |
| Rasmiaw | Guía Global y Recuperación activos; WhatsApp, Instagram, Messenger y comentarios conectados. | Envío (14), carrito abandonado (9), nuevo pedido (13). | 747 contactos y 623 conversaciones. Pago rechazado está preparado (`armed`) pero no activo. Zoho está desconectado. |
| Riverz oficial | La cuenta está configurada como **DeUNA Shop**, con asesora y recuperación activas; WhatsApp, Messenger y comentarios de Facebook conectados. | Entregado (0), confirmación contraentrega (1), carrito pendiente (0), despachado (1), cancelado (1). | 3 contactos y 2 conversaciones. El nombre de la cuenta no describe la marca que sus agentes atienden. |
| Riverz Demo | Dos agentes apagados, chat web conectado y Tiendanube activo. | Ninguna. | 68 contactos y 63 conversaciones. Tener chat conectado no equivale a tener respuestas automáticas activas. |

Hay otras cuentas Riverz de prueba; no se confundieron con el comercio oficial. Los 12 comercios activos tienen Operador habilitado y billetera. Dos no tienen aún fila de suscripción; la aplicación dispone de inicialización al leer. No se inventaron planes, cargos ni fechas de prueba para normalizar los datos.

La visión común es atención, recuperación y postventa desde una misma operación. Las diferencias de configuración comercial son legítimas; igualdad de herramientas no significa activar los mismos mensajes, canales o recetas en todos los comercios.

## Validación

- Suite completa: **357 archivos y 3.092 pruebas aprobadas**. Incluye dominios de Operador, panel, bandeja, contactos, IA, comentarios, voz, chat web, plantillas, campañas, automatizaciones, saldo, integraciones, ajustes y administrador.
- Tras los últimos cambios de facturación y deduplicación: **42 archivos y 467 pruebas específicas aprobadas**.
- Compilación de producción correcta con Next.js 16.3.5; comprobaciones de esquema y TypeScript incluidas.
- Lint de los archivos modificados sin errores. El lint global arrastra los pendientes descritos en el informe previo.
- Administrador: las 12 métricas comparadas vuelven a coincidir con consultas directas de la base.
- HTTP sin sesión: administrador, configuración de chat, campañas de voz y cron de voz rechazan con 401. Salud responde 200. GET de Operador respondió 404 y no se considera evidencia de autorización correcta por sí solo.
- Escaneo de patrones de credenciales en 2.080 archivos versionados: cero claves detectadas. La búsqueda adicional de contraseñas encontró valores de CI ficticios, nombres de columnas cifradas y una interpolación de variables, no claves literales reales. No es una auditoría exhaustiva de todo el historial Git ni de archivos personales no versionados.
- Auditoría repetible de permisos: `node --env-file=.env.local scripts/audit-security.mjs`, proporcionando `SUPABASE_ACCESS_TOKEN` exclusivamente por entorno. Es de solo lectura y reporta contadores, no datos de clientes.

## Límites y trabajo pendiente para una certificación operativa

1. No se hicieron cargos, llamadas, mensajes a clientes ni compras reales de extremo a extremo. Los estados conectados de proveedores no certifican entrega ni renovación futura de tokens.
2. Mercado Libre requiere reactivación externa. Rasmiaw tiene un flujo preparado y Zoho desconectado; Riverz Demo tiene agentes apagados. No se encendieron operaciones comerciales sin un diseño revisado.
3. La prueba de concurrencia SQL y las pruebas de colas, reservas y capacidad no son una prueba de miles de usuarios contra la infraestructura desplegada. Falta fijar un objetivo de usuarios/eventos simultáneos, ejecutar carga sostenida en un entorno representativo y medir latencia, errores, colas y límites de proveedores.
4. No se hicieron pruebas visuales en navegador, análisis forense histórico ni un pentest exhaustivo de todas las rutas y proveedores externos. No se puede concluir que los permisos antes expuestos nunca se hayan utilizado.
5. La activación por Operador de cualquier cambio publicado mantiene la aprobación correspondiente. Las integraciones que requieren autorización del proveedor no pueden convertirse en conexiones funcionales solo cambiando un estado en la base.
