# Revitaly — revisión de pruebas y feedback

Cuenta: Revitaly. Fecha: 27/09/2026.

Se revisaron 30 sesiones y sus 33 notas, repartidas en 17 sesiones. Las otras tablas de feedback, plataforma, cambios de plantilla y lotes no contenían registros para esta cuenta. Se conservaron las pruebas y comentarios originales: una conversación histórica no cambia cuando se corrige Natalia.

## Revisión nota por nota

Los identificadores son los primeros ocho caracteres de la sesión; «ítem» es el índice guardado en el sistema.

| Sesión / ítem | Observación | Resultado |
|---|---|---|
| 8794ad5b / 3 | «test» | Sin cambio: no contiene una indicación aplicable. |
| d8daadd0 / 2 | Texto de prueba sin significado | Sin cambio; conservado. |
| 550cf57d / 2 | Texto de prueba sin significado | Sin cambio; conservado. |
| 564aa64e / 2 | «Contame» | El voseo ya estaba configurado; se conserva. |
| f9c37127 / 2 | Presentación e información antes de orientar | Nueva regla de presentación e información. Cosmético, 16 activos; no se promete curar alopecia. |
| f9c37127 / general | Repite la presentación anterior | Duplicada: cubierta por la misma regla, sin crear instrucciones contradictorias. |
| 8e7166f7 / 2 | Compra directa, tres opciones | Corregido: web, Mercado Libre y transferencia 10%; sin diagnóstico previo. |
| 8e7166f7 / 7 | Link Mercado Libre y cierre | Corregido: enlace directo, sin reiniciar preguntas. |
| 8e7166f7 / 10 | Preguntar localidad primero | Corregido y probado. |
| 8e7166f7 / 13 | Córdoba, 2–5 días, despacho mañana | Rango configurado desde el despacho. No se promete mañana sin confirmación logística ni en días inhábiles. |
| 8e7166f7 / 15 | Agradecimiento sin insistir | Corregido y probado. |
| 8e7166f7 / 19 | Web con 5% primera compra | Corregido; REVITALY5 y enlace del producto. |
| 62f1d223 / 4 | Localidad antes del plazo | Cubierto por la regla de envíos. |
| 62f1d223 / 10 | Palermo, Flex 24/48 h, costos | Configurado; se distingue Flex de sucursal Andreani, sin inventar una sucursal Flex. |
| 62f1d223 / 16 | Cuatro precios, volúmenes y recomendación | Configurado y probado. No se anuncia «solo hoy» ni Express sin respaldo. |
| 62f1d223 / 19 | Tres medios, 5% web y 10% transferencia | Corregido, incluida transferencia fuera de recuperación. |
| 62f1d223 / 23 | Link Mercado Libre | Cubierto por compra directa. |
| 62f1d223 / 26 | Link web y primera compra | Cubierto por compra directa. |
| 4b3acc88 / 3 | No contra entrega; ofrecer Mercado Libre | Corregido y repetido en simulación; no ofrece el menú completo. |
| 4b3acc88 / 6 | Link Mercado Libre y cierre | Cubierto por compra directa. |
| 3499b952 / 3 | Tres cuotas: enviar web y 5% | Corregido y probado. |
| efadb5ca / 2 | Saludo y ausencia de local | Presentación asegurada en primera respuesta privada; canales oficiales configurados. |
| efadb5ca / 5 | No farmacias; ofrecer enlaces | Regla configurada y respuesta comprobada. |
| e2deaab2 / 2 | Falta saludo de postventa | Presentación corregida también para seguimiento. |
| e2deaab2 / 5 | Número o nombre completo | Se acepta para orientar al equipo. No se revelan pedidos privados solo con nombre/número. |
| cc0e7693 / 5 | No encuentra pedidos | #1673 existe. Corregida búsqueda por correo en simulación; verificación real por correo y número satisfactoria. |
| a7d69cab / 3 | Dice «no encontré» antes de tener datos | Corregido: pide identificación sin declarar inexistencia. |
| b492c571 / 6 | Buena atención, no detecta número | Mismo fallo de identificación; consulta #1673 + correo comprobada. |
| b492c571 / 12 | Buscar correo/nombre/número | Correo solo y correo + número funcionan. Nombre solo requiere verificación o equipo, no habilita acceso a datos de terceros. |
| 0c17f3f2 / 3 | No cancelar en tránsito | Corregido y probado. Equipo coordina devolución; no se impone costo al comprador para cualquier motivo indiscriminadamente. |
| 148dea56 / 9 | Precio por privado, agresivas en público | Las críticas ya no se ocultaban automáticamente para Revitaly; ahora además no disparan un DM comercial por sí solas. Pedidos/reclamos privados siguen protegidos. |
| 148dea56 / 10 | Mismo asistente que WhatsApp | Natalia compartida; mismas reglas de compra en DMs, comprobadas en Instagram. |
| c87f615f / 3 | Gmail debe redirigir a WhatsApp | Ya corregido antes; vuelto a comprobar, sin precios ni resolución por correo. |

## Cambios aplicados en la cuenta

Nueve reglas reconciliadas, descuentos, personalidad y conocimiento de Natalia actualizados. Copias de seguridad locales previas a cada aplicación. No se alteraron otros comercios ni el agente inactivo de Mercado Libre. Las plantillas PDF v5 y sus vínculos anteriores permanecen intactos.

La transferencia de 4 meses a sucursal se comprobó en $55.791, con alias configurado; el equipo sigue verificando acreditaciones. No se enviaron mensajes a clientes ni se crearon pedidos o pagos reales.

## Fallos técnicos encontrados al repetir las pruebas

- Los volúmenes de 300/600/900/3000 ml eran interpretados como precios no autorizados: corregido conservando el bloqueo de importes monetarios inventados.
- La comprobación en producción detectó además que «$49.990. 1 frasco» se interpretaba como 49990,1: corregida la separación entre importes, oraciones y cantidades, con pruebas de regresión.
- El cargador tomaba solo 25 reglas y dejaba fuera nuevas instrucciones: ampliado a 50.
- El editor recortaba instrucciones a 600 caracteres al guardarlas: ampliado a 4000 para conservar las reglas completas aplicadas.
- La búsqueda local por correo en simulaciones incluía `contact_id` vacío: corregido. #1673 encontrado por correo y por número + correo; número solo continúa protegido.
- Saludo inconsistente en el primer turno: normalizado para los canales privados de Revitaly, sin repetirlo en conversaciones iniciadas ni interferir con correo.
- Pregunta de costo de envío confundida con precio de tratamientos: enfoque corregido y repetido para Palermo.

## Facturación y comentarios

Los dos comentarios ocultos de la captura estaban registrados como ocultados por una persona, con el identificador del propietario. Los intentos de IA asociados figuraban omitidos por falta de saldo; no hay evidencia en ese hilo de ocultamiento por IA.

Se añadió una verificación de acceso justo antes de la moderación automática y motivos diferenciados de impago/suscripción vencida. No se bloqueó la moderación manual.

La activación desde Stripe prepara la billetera antes de activar la suscripción, conserva el modelo de cobro y recupera el método de pago autorizado cuando corresponde. La interfaz actualiza el acceso y muestra Saldo al activar una cuenta de ese modelo. Una tarjeta agregada no equivale a una recarga: con saldo cero, el consumo de IA sigue bloqueado. No se acreditó dinero, activó autorrecarga ni cobró una tarjeta durante esta tarea.

Referencia técnica: [Checkout de Stripe](https://docs.stripe.com/api/checkout/sessions/object).

## Validación

18 escenarios de Natalia ejecutados sin envíos externos; se repitieron contra entrega, Palermo y local físico tras corregir las diferencias encontradas. Gmail, compra directa, enlaces, precios, transferencia, agradecimiento y cancelación fueron comprobados. Los escenarios históricos se preservan como evidencia, no se reescriben como si siempre hubieran respondido bien.

Compilación de producción y ESLint satisfactorios. La suite final de 22 archivos pasó sus 138 pruebas, incluida la paridad entre comentarios simulados y reales. La activación de Stripe se prueba con eventos simulados y suscripciones verificadas simuladas; no se realizó un checkout real con tarjeta del comercio.

Comprobaciones autenticadas de producción: Natalia y sus reglas actualizadas visibles; las 30 sesiones originales intactas; cuenta todavía en cortesía/sin pagar; webhook de Stripe rechaza con HTTP 400 una solicitud sin firma. La simulación de crítica responde públicamente sin ocultar, abrir un privado ni afirmar que la publicidad es auténtica. Tablero y cuatro editores de automatización mantienen sus plantillas PDF v5, sin vínculos v4.

Meta confirmó directamente que las 21 plantillas PDF v5 están en PENDING. No se presentan como aprobadas ni enviadas. La habilitación real sigue dependiendo del pago del comercio, saldo cuando corresponda y requisitos propios de Meta.
