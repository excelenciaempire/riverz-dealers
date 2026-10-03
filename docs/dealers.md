# Riverz Dealers

## Producto

La base de Riverz aporta contactos, bandeja multicanal, agentes, plantillas,
campañas y automatizaciones. El proceso del vendedor de carros añade:

1. Un inventario de **unidades concretas**: inventario/VIN, marca, modelo, año,
   kilometraje o millaje, precio y moneda, fotos y disponibilidad.
2. Una oportunidad abierta por comprador, con varios vehículos de interés,
   presupuesto, preferencias, motivo, objeción, tipo de comprador, plazo, financiamiento y vehículo a cambio.
3. Visitas y pruebas de manejo que relacionan comprador, vehículo y vendedor.
4. Seguimiento con fecha, contexto y pausa explícita, visible en el panel diario.

`/panel` muestra el día de ventas. `/concesionario` (inglés: `/dealer`) incluye
las vistas de vehículos, oportunidades, citas y BDC. La guía de fuentes y decisiones está en [dealer-sales-playbook.md](dealer-sales-playbook.md). Desde una conversación se puede
consultar la oportunidad y abrir su ficha; desde una oportunidad se abre la
conversación más reciente del comprador.

El menú de ventas reúne Hoy, Pipeline, Bandeja, Citas, Vehículos y Contactos.
Asistente, Automatizaciones y Plantillas están agrupados como IA y seguimiento;
Integraciones y Ajustes permanecen al pie. BDC se abre desde Hoy, sin duplicar
el menú con las superficies heredadas del producto base.

El pipeline (`/concesionario?view=opportunities`) agrupa compradores en siete
etapas. Permite arrastrar tarjetas o cambiar su etapa con un selector accesible
desde teclado y teléfono. El cambio sólo escribe la etapa, dentro del workspace
de la sesión, y compara la etapa anterior para evitar sobrescribir un movimiento
simultáneo. Recarga las citas y seguimientos después de guardar. Cerrar y reabrir
una tarjeta conserva las reglas de pausa; no reactiva envíos automáticamente.

La cuenta demo usa una captura del inventario público de Toyota of North Miami:
sólo unidades en stock, con VIN, fotos y enlace a la ficha original. Las unidades
en tránsito o en fabricación se excluyen. Los compradores, actividades y citas
siguen siendo ejemplos; el inventario del propietario permanece independiente.
La captura no constituye una sincronización continua: cada ficha indica cuándo
se consultó y la disponibilidad debe confirmarse antes de vender.

Una unidad sin Cyber Price publicado guarda `price = NULL` y muestra Consultar
precio / Call for price. Nunca se sustituye por cero, MSRP ni un precio con
ofertas condicionales. La herramienta de inventario puede devolver estas unidades
al buscar por presupuesto, pero su ajuste al presupuesto requiere confirmación.
La verificación de precios de IA conserva los hechos del vehículo y excluye los
precios nulos de las cotizaciones autorizadas. El millaje no publicado de una
unidad nueva se muestra como Nuevo, sin afirmar un odómetro verificado.
La moneda habitual se obtiene de los vehículos disponibles del workspace,
sin heredar el COP predeterminado de ecommerce. Cada unidad conserva su moneda
publicada; el asistente no convierte precios entre monedas.
Las notas originales se conservan en las fichas. La herramienta de IA reserva
los importes complementarios en texto libre para revisión del vendedor, evitando
confundir cargos, cuotas o descuentos con el precio estructurado verificado.

## Asistente conversacional

El bucle compartido `runWithTools` añade el contexto de Dealers y reemplaza el
catálogo de herramientas de ecommerce por:

- `dealer_search_vehicles`: busca unidades disponibles en vivo. Un presupuesto
  requiere moneda explícita. Los resultados están limitados a 12 por consulta.
- `dealer_save_buyer`: guarda lo que compartió el comprador. El servidor fija
  el contacto y workspace; la IA no puede cambiar la etapa ni cerrar una venta.
- `dealer_request_appointment`: solicita un horario futuro con offset y acuerdo
  del comprador. La cita queda **por confirmar**, a cargo del propietario del
  workspace. El vendedor la confirma en la agenda.

Se conservan las herramientas de conversación y escalada que ya estuvieran
habilitadas. No se exponen herramientas de pedidos, checkout, cobros ni acciones
administrativas a la IA conversacional de Dealers. Las simulaciones no escriben.

El financiamiento y la valoración del carro a cambio son solicitudes para una
persona. No se solicitan datos bancarios, SSN ni documentos crediticios.
La agenda comprueba solapamientos; el vendedor confirma sus horas de atención.
Este MVP está orientado al vendedor individual. La asignación avanzada entre
vendedores y la integración con Google Calendar/DMS no están implementadas.

## Persistencia y reglas

La migración `375_dealers.sql` crea cuatro tablas con RLS por membresía:
`dealer_vehicles`, `dealer_opportunities`, `dealer_interests`, `dealer_appointments`.
Los vínculos compuestos garantizan que vehículo y oportunidad estén en el mismo
workspace, incluso en llamadas con service role. Un trigger valida el comprador.

Las citas pendientes o confirmadas bloquean solapamientos por vendedor o
vehículo. Se usa un lock transaccional por vendedor y un bloqueo del vehículo.
La agenda permite reprogramar una cita existente sin cambiar comprador,
vehículo ni vendedor; vuelve a comprobar disponibilidad y conflictos.
Una unidad reservada o vendida no se puede agendar. Las fechas se guardan en UTC;
el formulario y la agenda muestran explícitamente la zona horaria del navegador.

Cambiar una unidad a reservada/vendida cancela sus citas futuras y pausa los
seguimientos vinculados. Cerrar una oportunidad pausa su seguimiento y cancela
sus citas pendientes. El opt-out del contacto pausa seguimientos y cancela citas.
Cambiar una oportunidad a venta no marca automáticamente todos los vehículos
de interés como vendidos: el vendedor marca la unidad vendida en el inventario.

El panel mantiene una **lista de tareas para el vendedor**. La migración
`376_dealer_automations.sql` añade dos disparadores al motor de automatizaciones:
`dealer_follow_up_due`, al vencer la fecha de seguimiento, y
`dealer_appointment_reminder`, durante las 24 horas anteriores a una cita
confirmada. La galería de Dealers ofrece ambas recetas en español e inglés.
Nacen pausadas; el vendedor elige una plantilla aprobada antes de activarlas.
La migración `377_dealer_sales_execution.sql` agrega actividad del vendedor,
captura automática de oportunidades para nuevos contactos, contexto BDC y
preparación de citas. Añade `dealer_no_show` y `dealer_post_visit`: una acción
acotada tras un resultado registrado, invalidada por contacto posterior,
respuesta del comprador o nueva cita. Registrar actividad no envía mensajes
ni realiza llamadas. Las métricas distinguen llamadas conectadas de intentos.

El cron existente revisa los eventos cada minuto. Una clave única por
automatización, comprador y fecha impide duplicar los eventos. Antes de enviar,
incluso después de una espera, se comprueban el workspace, el comprador,
el opt-out, la pausa, la etapa y la fecha original. Cancelar o reprogramar
invalida un recordatorio pendiente; cerrar la oportunidad o vender/reservar
el vehículo detiene los mensajes vinculados. Se conservan las barreras de
envío, ventanas, cupos y logs de Riverz. Los eventos de seguimiento vencen
tras un día; los recordatorios vencen al comenzar la cita. No se repite
automáticamente un envío cuyo resultado quedó incierto.

## Puesta en servicio

Usar un proyecto Supabase independiente de Riverz ecommerce. Aplicar las
migraciones de la base siguiendo la configuración de Supabase del proyecto y
después las migraciones `375`–`378`. Configurar las credenciales de ese proyecto y una URL
propia en las variables de entorno; nunca apuntar este fork a la DB de ecommerce.

`render.yaml` define `riverz-dealers` y un worker de voz independiente. Las URLs,
claves de Supabase, proyecto de telemetría y secretos no se heredan del despliegue
de Riverz. El chequeo `check-dealers-schema.cjs` bloquea el build en Render si no
están las tablas y la función de control de automatizaciones.

La configuración de producción usa `https://riverz-dealers.onrender.com` y el
proyecto Supabase independiente `evsgprtgbmmtqfaamtze` (`riverz-dealers`, Frankfurt).
La base inicial contiene 399 migraciones; la ejecución comercial y los precios
no publicados añaden las migraciones 377 y 378. La reconstrucción desde
cero conserva el seed de Pilar sólo cuando ese workspace existe (077) y crea
`voice_system_prompt` antes de otorgarle permisos (129).
Los secretos de cifrado y cron son propios de Dealers. Las claves de proveedores
de IA, scraping, correo y la aplicación Meta existente se configuran en Render;
no se copian contactos, canales conectados ni credenciales de la DB ecommerce.
La aplicación Meta conserva sus callbacks actuales: no se cambian los webhooks
de Riverz ecommerce al publicar Dealers. La conexión de canales requiere su
configuración correspondiente. La telemetría Latitude está desactivada hasta
configurar un proyecto propio.

La app conserva otras superficies del proyecto base (operador de cuenta, voz,
integraciones, landing antiguas y documentación legal). La adaptación del
asistente descrita aquí corresponde al bucle conversacional compartido; el
operador de cuenta y el motor de voz no tienen herramientas de Dealers propias.
El menú principal ya prioriza Dealers y no muestra productos ni pedidos.
La creación de asistentes usa todo el inventario de vehículos: no exige un
producto de ecommerce. Su editor muestra las capacidades de Dealers y oculta
las opciones de checkout y cobro.

## Validación

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
Las pruebas de `src/lib/dealers` ejecutan SQL real con PGlite y comprueban
aislamiento, relaciones, disponibilidad, conflictos, opt-out, cierre y rollback.
Las pruebas de herramientas verifican el contacto fijo, moneda, consentimiento,
simulación y exclusión del checkout. La suite heredada se ejecuta en modo
ecommerce para conservar sus comprobaciones originales; Dealers es el modo
predeterminado de la aplicación y se prueba explícitamente.

La prueba de contrato respeta las recetas ocultas por despliegue y comprueba
que la receta `novedad-entrega` no pueda previsualizarse si su flag está apagado.
La suite completa se ejecuta con dos workers para limitar la memoria.
