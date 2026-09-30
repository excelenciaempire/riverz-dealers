# Ejecución del plan de mejoras de Riverz

Referencia: [plan final](plan-final-mejoras-riverz-commslayer.md). Inicio: 29 de septiembre de 2026.

Esta lista registra el estado real del trabajo. Una implementación local, una validación automatizada y una comprobación en producción son estados separados.

| Bloque | Implementación | Validación | Producción |
| --- | --- | --- | --- |
| P0A Contrato y ejecución de aprobaciones | Implementada | Pruebas y build correctos | Esperando despliegue |
| P0B Cifras del Operador | Implementada | Pruebas y build correctos | Esperando despliegue |
| P0C Disparadores de etiquetas y fecha | Implementada | Pruebas SQL y build correctos | Esquema aplicado; código esperando despliegue |
| P0D Plantillas y traducciones | Implementada | Pruebas y build correctos | Esperando despliegue |
| P0E Accesos y regresión | Implementada | Pruebas de aislamiento y build correctos | Esperando despliegue |
| B1 a B4 Atención y pedidos | Auditoría de B1 | Pendiente | Pendiente |
| A1 a A3 Superasistente | Pendiente | Pendiente | Pendiente |
| C1 y C2 Crecimiento | Pendiente | Pendiente | Pendiente |
| O1 a O5 Autoservicio y operación | Pendiente | Pendiente | Pendiente |
| E1 a E4 Extensibilidad | Pendiente | Pendiente | Pendiente |
| X1 a X5 Paquetes posteriores | Pendiente | Pendiente | Pendiente |
| M1 a M5 Comunicación | Pendiente | Pendiente | Pendiente |
| Expansión a Estados Unidos | Decisiones comerciales pendientes | No modificada | No modificada |

## Entrega P0

- Contrato estricto de aprobar/rechazar, compatibilidad durante el despliegue, decisión atómica y comprobación de caducidad. Fallos de carga visibles con reintento.
- Atribución del Operador consume las categorías reales `ia`/`humano`; las etiquetas indican quién atendió, sin atribuir causalidad de cierre.
- Etiquetas: evento de base de datos únicamente en inserciones nuevas, automatización y cuenta exactas, cadena de hasta ocho reglas y corte de ciclos. Horarios: HH:mm o cron de cinco campos con zona del negocio o zona explícita; deduplicación de cada horario local, incluida la hora repetida por cambio de horario.
- Cola persistente con reclamo atómico y caducidad. Una ejecución interrumpida queda con resultado incierto y no se repite automáticamente. Las esperas y el historial por pasos siguen usando el motor actual.
- Generación con IA dentro del editor manual de plantillas: borrador editable y aplicación explícita. No lo envía a Meta. Calculadora localizada en ambos idiomas.
- Accesos desde la ficha del contacto a aprobaciones, devoluciones y logística, con filtro por contacto para las dos primeras. Aprobaciones antiguas se asocian por pedido. La navegación principal se conserva.

Validación del 29 de septiembre: **52 archivos y 452 pruebas correctas**, lint de las superficies nuevas y build completo de Next.js. Migración **303** aplicada de forma atómica; guard de esquema comprobado contra Supabase. La comprobación del despliegue se registra después del push, sin ejecutar envíos ni movimientos financieros como prueba.
