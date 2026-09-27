# Revitaly — checkout, activación y limpieza

## Checkout verificado

Se abrió el enlace íntegro proporcionado, exclusivamente para lectura. Stripe muestra el correo de Revitaly, «Contactos ilimitados con saldo», 30 días sin cargo de mensualidad y después US$399 al mes. En la consulta del 27 de septiembre, indicaba primer cobro el 27 de octubre de 2026. El texto aclara que el uso de IA se descuenta del saldo recargado por separado.

El acuerdo de Revitaly en Riverz coincide: modelo saldo, mensualidad US$399. La auditoría del enlace del admin registra primerMesSinCargo=true. La cuenta sigue en cortesía, con saldo cero y sin suscripción Stripe completada. No se ingresaron datos de tarjeta, confirmó un checkout ni modificaron condiciones financieras.

## Regla por modalidad, enlaces del admin dashboard

| Modalidad | Después de completar Stripe | Saldo Riverz |
|---|---|---|
| Contactos | Plan activo; IA incluida según el cupo contratado | No requiere recarga |
| BYOK | Plan activo; IA con la clave propia previamente configurada. Si falta, aviso y enlace al editor para agregarla | No requiere recarga |
| Mensualidad más saldo | Plan activo; aparece recarga. La IA consume únicamente con saldo disponible | Requiere saldo de consumo |

No se convierte una modalidad en otra. El primer mes sin cargo solo se aplica cuando se selecciona al generar el enlace. Las pruebas de Checkout verifican identidad del comercio, precio acordado, recurrencia y esa opción. Un checkout abierto no habilita acceso; la activación depende del webhook firmado y del estado autorizado de Stripe. No se efectuó un pago real de prueba.

Se recuperó el campo de clave Anthropic en Opciones avanzadas del asistente. Se guarda por la API existente que cifra el valor; un campo vacío conserva la clave. Facturación avisa a BYOK sin clave y enlaza su propio asistente. La presencia de clave no certifica que el proveedor la acepte ni que tenga crédito; no se probaron claves de comercios mediante cargos reales.

## Limpieza solicitada

- Eliminadas 38 plantillas antiguas v3/v4 tanto en Meta como en Riverz. Sin referencias en las seis automatizaciones, campañas, flujos o ejecuciones pendientes.
- Conservadas 23 plantillas utilizadas: 21 PDF v5 y las dos de confirmación/despacho. Meta sigue indicando 21 pendientes de aprobación.
- Eliminadas 14 pruebas con feedback resuelto; permanecen 16 sesiones sin modificar: 13 sin notas y 3 notas sin indicación aplicable. No se borraron conversaciones de clientes.
- Verificación autenticada posterior: tablero y cuatro editores conservan los textos y botones PDF; sin vínculos v4. Meta y Riverz devuelven exactamente 23 plantillas.

Respaldo local de contenido y sesiones: `tmp/revitaly-cleanup-backup-1790526113580.json`. Las sesiones se pueden reponer desde ese respaldo. Las plantillas borradas de Meta no se restauran con su aprobación anterior: recrearlas exige el proceso de Meta. Registro nota por nota en `output/revitaly-feedback-2026-09-27.md`.

La activación del plan no elimina requisitos externos: aprobación y método de pago de Meta, canales conectados y claves propias válidas cuando correspondan.

## Validación técnica

92 pruebas en 18 archivos satisfactorias, incluyendo Checkout, activación, contactos, billetera, BYOK con/sin clave y moderación. TypeScript y compilación de producción satisfactorios. El primer chequeo independiente de tipos agotó el límite local de 2 GB; la repetición con memoria ampliada terminó correctamente.
