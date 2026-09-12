# Auditoría de Riverz — 12 de septiembre de 2026

## Resultado

Se revisaron el código, la suite automatizada, la compilación de producción y las consultas reales de la base configurada. Se corrigieron discrepancias entre la aplicación y el administrador. El resumen del administrador, que fallaba por tiempo máximo, volvió a funcionar después de aplicar la migración 258 en Supabase.

La revisión no demuestra ausencia absoluta de bugs. No incluyó una prueba visual de cada pantalla, mensajes reales a clientes, llamadas reales ni cargos de prueba. La comprobación de conexiones mide su estado registrado y la disponibilidad de consultas; no certifica la entrega extremo a extremo de cada proveedor.

## Correcciones

1. **Funciones desactualizadas en sesiones abiertas.** El menú y la protección de rutas ahora releen los ajustes efectivos del comercio cada 30 segundos, al navegar y al volver a la pestaña. La consulta exige autenticación, resuelve el comercio en el servidor y no se almacena en caché. Un fallo conserva el último estado conocido.
2. **Permisos de Comentarios IA.** Se agregó la sección al catálogo de permisos para que un miembro restringido no entre por una ruta que antes quedaba sin clasificar. Se probó en español e inglés.
3. **Bucle de redirección.** El destino debe cumplir simultáneamente los permisos del miembro y las funciones habilitadas. Si no hay una sección disponible, se usan Ajustes. Se contempla también el apagado de Operador.
4. **Comercio activo diferente en cliente y servidor.** Ambos priorizan el comercio propio y después la membresía más antigua; los empates se resuelven por identificador. Se descartan comercios eliminados y una excepción de red no deja la carga inicial indefinidamente activa.
5. **Escrituras de funciones mal validadas.** El administrador rechaza valores e identificadores inválidos antes de escribir. Una excepción por comercio no puede convertirse accidentalmente en un cambio global por un identificador vacío. Los errores mostrados se localizan.
6. **Lecturas fallidas presentadas como datos válidos.** El panel administrativo no reemplaza una lectura fallida de funciones por “todo habilitado”, ni una consulta fallida de contadores o saldo por cero. Los contadores de excepciones se paginan.
7. **Indicador de saldo inconsistente.** El administrador contempla las reservas de operaciones y la exención de cuentas de cortesía. Los importes y fechas de la ficha usan el idioma activo.
8. **Resumen administrativo lento.** La migración 258 agrupa cada tabla de eventos una sola vez y obtiene la última ejecución de cada tarea usando el índice, sin recorrer todas las ejecuciones históricas. Se preservan los permisos de ejecución exclusivos de `service_role`.
9. **Pruebas inestables.** Se identificaron dos falsos positivos de español neutro —pretéritos, no voseo— y se fijó el reloj de la prueba de recuperación de Gmail. La prueba de esquema Zoho pasó por separado y en la ejecución completa con concurrencia limitada.

## Cobertura por funcionalidad

| Funcionalidad | Comprobación realizada |
| --- | --- |
| Operador | Suite de operator, capabilities y operacion; apagado por administrador y redirección |
| Panel | Suite de dashboard/analytics; consulta real del resumen y comparación con tablas |
| Bandeja | Suite de inbox, channels y WhatsApp; selección del comercio |
| Contactos | Suite de contacts; conteo real comparado con el administrador |
| Asistente IA | Suite de ai; estados, herramientas, consumo y recuperación cubiertos por pruebas existentes |
| Comentarios IA | Suite de comments; permisos y traducción de rutas |
| Llamadas y notas de voz | Suites de voice/voice-notes; esquema real requerido y conteo administrativo |
| Chat web | Suite de webchat/API y widget existente; ajuste administrativo compartido |
| Plantillas | Suite de templates/WhatsApp; ajuste administrativo compartido |
| Campañas | Suite de broadcasts/automations; permisos y ajuste administrativo |
| Automatizaciones | Suite de automations y cron; consulta real de salud de tareas |
| Saldo | Suite de wallet/billing; reservas, cortesía y esquema real |
| Integraciones | Suites de channels/commerce/shopify; esquema de recuperación y estado real registrado |
| Ajustes | Pruebas de auth/workspaces/CSRF existentes; selección de comercio y permisos |
| Administrador | Pruebas de autorización, aislamiento, funciones, navegación, billetera y equivalencia SQL |

Estas filas describen cobertura automatizada y revisión de código, no recorridos manuales completos de cada interfaz.

## Validación

- Suite completa: **351 archivos, 3.067 pruebas aprobadas**. Después de completar la optimización SQL se repitieron sus pruebas específicas satisfactoriamente.
- Compilación de producción: completada, incluyendo TypeScript y generación de 225 páginas estáticas.
- Lint de los archivos de aplicación modificados: sin errores.
- Esquemas reales de billetera, recuperación de integraciones y notas de voz: comprobados.
- `riverz.co/api/health`: HTTP 200, Supabase y WhatsApp en estado `ok`.
- Migración `258_admin_overview_single_pass.sql`: aplicada en una transacción mediante la API de administración de Supabase. Se verificó equivalencia de resultados con PostgreSQL embebido, reaplicación y permisos de ejecución.
- Consulta de salud de tareas: observación anterior **16.553 ms**; observación posterior **556 ms**. Son mediciones puntuales, no un benchmark sostenido.
- Resumen administrativo: antes HTTP 500 / SQLSTATE 57014; después responde y coincide en las doce métricas comprobadas.

## Comparación con datos reales

Comprobación del 12 de septiembre a las 19:38 UTC. Los eventos se compararon para el intervalo `[2026-09-05 00:00 UTC, 2026-09-12 00:00 UTC)`; los totales generales son instantáneas de lectura.

| Métrica | Administrador | Consulta directa |
| --- | ---: | ---: |
| Comercios totales | 13 | 13 |
| Comercios activos | 12 | 12 |
| Comercios eliminados | 1 | 1 |
| Contactos | 5.564 | 5.564 |
| Conversaciones no eliminadas | 3.036 | 3.036 |
| Conexiones de mensajería conectadas | 20 | 20 |
| Conexiones de mensajería con error | 1 | 1 |
| Mensajes entrantes | 945 | 945 |
| Mensajes salientes | 995 | 995 |
| Respuestas IA enviadas | 162 | 162 |
| Llamadas | 3 | 3 |
| Pedidos | 168 | 168 |

No se compararon individualmente todas las métricas de ingresos, atribución y cada proveedor externo. La equivalencia SQL local cubre el contrato completo del resumen con datos de prueba.

## Pendientes y límites

- **Mercado Libre:** una conexión sigue en `error` porque el proveedor informa que la cuenta está inactiva. Requiere reactivar la cuenta en Mercado Libre para recuperar la sincronización. Se conservó el estado real; no se marcó artificialmente como conectado.
- **Lint general preexistente:** 34 errores y 182 advertencias en la revisión inicial, incluyendo archivos temporales ajenos y reglas de React en componentes fuera de los cambios. No todos representan fallos de ejecución, pero el lint global no queda certificado como limpio.
- No se hizo validación visual del navegador. Se priorizaron código, pruebas y API conforme a la preferencia del propietario.
- La preferencia de usar navegador solo cuando sea necesario se guardó en las instrucciones generales de Codex del equipo, fuera de este repositorio.
- La credencial nueva de Supabase se usó en el entorno del proceso; no se incorporó al repositorio ni a este informe.
