# Auditoría de Operador — 9 de septiembre de 2026

## Resultado y alcance

Se revisaron el catálogo registrado, su distribución entre especialistas, las vistas de resultados, el chat, la ejecución de planes y el cobro del proveedor. El catálogo tiene 117 capacidades en 22 dominios. Esto no demuestra paridad con cada control de Riverz ni ejecución real de todas las integraciones externas.

| Dominio | Capacidades |
| --- | ---: |
| Agentes | 9 |
| Ajustes | 6 |
| Aprobaciones | 2 |
| Automatizaciones | 12 |
| Bandeja | 9 |
| Campañas | 5 |
| Comentarios | 9 |
| Contactos | 5 |
| Conversaciones | 10 |
| Etiquetas | 3 |
| Flujos | 5 |
| Integraciones | 3 |
| Mensajes | 2 |
| Métricas | 3 |
| Operación | 1 |
| Pedidos | 7 |
| Plantillas | 6 |
| Productos | 4 |
| Prospección | 4 |
| Rasmiaw | 3 |
| Segmentos | 5 |
| Voz | 4 |

Las pruebas verifican que cada capacidad registrada llega a Operador y tiene un especialista o una asignación explícita al orquestador. Las escrituras tienen vista previa y artefacto; las lecturas tienen vista, salvo `metricas.resumen`, cuya exclusión visual es deliberada en el proyecto. Esto verifica contratos de código, no cada operación contra proveedores reales.

## Corregido

- Las tres capacidades de Rasmiaw estaban sin especialista y sin vista. Las dos escrituras tampoco tenían vista previa. Ahora pertenecen a Automatizaciones y muestran preparación/resultados en español e inglés. Se conserva su restricción a la cuenta de Rasmiaw.
- Ejecutar un plan aprobado omitía la puerta de saldo/suscripción. Se comprueba antes de reclamarlo; una clave de IA ausente tampoco deja el plan atrapado como iniciado.
- La ruta podía sobrescribir el estado calculado por el ejecutor, clasificando incorrectamente planes con pasos omitidos. Ahora conserva el resultado del ejecutor.
- El chat marcaba todos los planes como listos. Ahora muestra resultados parciales/fallidos y evita ofrecer una segunda aprobación de un plan ya iniciado. Una pérdida de conexión no inventa un resultado definitivo.
- Los avisos de saldo y suscripción y el resumen de planes usan traducciones es/en. Los errores generales del proveedor no se imprimen directamente desde la ruta.
- Las nuevas reservas de IA incluyen el identificador del hilo y, al ejecutar un plan, el identificador del plan, para facilitar conciliación.

## Evidencia de cobro

Consulta de solo lectura a la base configurada en `.env.local`:

- `wallet_movimientos`, concepto `ia_operador`: tres movimientos de consumo no nulos, por un total de -60 centavos; entre el 30 de agosto y el 4 de septiembre de 2026.
- `operator_messages`: 30 respuestas de asistente con tokens registrados; la última del 4 de septiembre.
- `wallet_operaciones`, concepto `ia_operador`: ninguna operación al consultar.

Hay evidencia de cobros históricos, pero no una conciliación que demuestre cobro de cada respuesta. No se hicieron cobros retroactivos ni se ejecutaron consumos pagados para probarlo.

El código actual reserva antes de cada generación y liquida el consumo reportado por el proveedor. Las pruebas recorren el SDK real con transporte simulado para el orquestador y un especialista, verificando reserva, liquidación única, importe y bloqueo sin fondos. Las pruebas SQL verifican idempotencia, fracciones y rollback. Se mantienen las excepciones existentes de cortesía y claves propias.

## Pendiente para afirmar cobertura total

- La configuración de Chat web (`src/app/api/webchat/config/route.ts`) no está expuesta como capacidad. Pasar las pruebas del catálogo no cubre esa pantalla.
- Voz expone consulta y llamada, pero no todos los controles de creación/configuración de campañas. Ajustes no expone cada operación de facturación.
- OAuth y la autorización de medios de pago siguen requiriendo interacción de la persona.
- No se completó QA visual en navegador: la revisión automática bloqueó el comando de inicio de Chrome aislado, sin un motivo más específico. No se verificaron tamaños móvil/escritorio mediante capturas.
- Los cambios de esta tarea requieren despliegue y una conciliación posterior de un consumo real para confirmar el comportamiento en producción.

## Validación

601 pruebas aprobadas en 43 archivos: Operador, capacidades, SDK/cobro, reservas SQL y ruta de planes. ESLint sin errores en los archivos revisados; siete advertencias existentes de dependencias de hooks en el chat. TypeScript aprobado. Después de añadir referencias de hilo/plan a las reservas y ajustar el tratamiento de conexiones interrumpidas, se repitieron TypeScript y 40 pruebas relacionadas: aprobados.
