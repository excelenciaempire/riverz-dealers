# Revisión del onboarding comercial — 12 de septiembre de 2026

## Alcance comprobado

El canvas usa 52 escenarios base, en español e inglés, con disparador o consulta, respuesta o acción, resultado favorable y excepción. Ocho respuestas transversales pueden continuar en la misma línea: atención humana, silencio, cambio de tema, archivos, baja, falta de conocimiento, integración fallida e identidad. Las acciones internas no ofrecen un selector de respuestas del cliente.

No se afirma que un catálogo finito incluya todas las conversaciones posibles. Los casos propios del comercio se registran en Personalizar, aparecen conectados en el canvas como pendientes de diseño y se conservan en la propuesta. No se fabrican mensajes aprobados para requisitos aún sin diseñar.

## Correspondencia con funcionalidades del producto

Fuentes revisadas: `src/lib/capabilities/registry.ts`, `src/lib/admin/feature-flags.ts`, `src/lib/automations/trigger-meta.ts`, `src/lib/ai/tools.ts`, rutas del dashboard y snapshots del onboarding.

| Familias de capacidades | Escenarios que las explican |
| --- | --- |
| agents, products | knowledge, recommend, stock, suitability |
| messaging, outbound | templateapproval, campaign, optout, failure |
| inbox, bandeja, contacts | welcome, crm, human, identity, topic, media |
| automations | dispatch, paymentpending, delivered, abandoned, reactivation |
| flows | menu |
| broadcasts | campaign |
| orders | checkout, editorder, receipt, paymentlink, cancel, refund, return, invoice |
| approvals | approval |
| comments | publicsale, publiccomplaint, publicfilter |
| voice | voicecall, human |
| prospecting | prospecting |
| integrations, health | integration, failure |
| metrics | reporting |
| workspace | operator, crm, approval, hours |
| webchat | welcome |
| rasmiaw | codconfirm, codconvert, dispatch y snapshots propios de la marca |

Esta correspondencia cubre familias de funciones orientadas al comercio. No afirma disponibilidad de todas las herramientas en todas las cuentas: dependen de conexiones, permisos y configuración. Las operaciones administrativas sobre usuarios, facturación o proveedores no se presentan como automatizaciones de atención al comprador.

## Coherencia de la propuesta

- Anticipado excluye confirmación, conversión, rechazo de recepción y recaudo contraentrega.
- Contraentrega pura excluye pago anticipado pendiente, enlace de pago, transferencia y recuperación de pago rechazado.
- Híbrido permite ambos recorridos; la conversión de contraentrega a anticipado depende de la opción de ofertas.
- Las funciones desactivadas y los escenarios excluidos se retiran del diseño y de `scope` en la exportación. `referenceCases` conserva el material histórico por separado.
- Los snapshots históricos conservan sus estados y siguen disponibles como referencia. No se modifican automatizaciones reales desde esta pantalla.
- Los resúmenes antiguos no se repiten al lado de los escenarios nuevos en la vista expandida. El detalle técnico y las plantillas originales permanecen disponibles.
- Tracking numérico, URL de tracking y URL de checkout usan variables diferentes.
- Abrir Propuesta o Plantillas conserva el canvas montado, sus ramas y su posición. Si el escenario seleccionado deja de aplicar, se vuelve a un escenario disponible.

## Datos que se acuerdan en onboarding

Canales y conexiones; medios y condiciones de pago; horarios, responsables y aprobaciones; logística y políticas de cambios/devoluciones; tono e idioma; casos particulares; escenarios incluidos; condiciones comerciales. Riverz diseña e implementa el flujo; la propuesta no crea una cuenta, no activa envíos y no inicia cobros.

## Verificación

Las pruebas cubren traducciones, conectividad de aristas, identificadores únicos, ausencia de solapamientos y estabilidad de las ramas. Se añadieron combinaciones de las tres marcas con los tres modelos de pago, funciones desactivadas y exclusiones individuales. Los tests de formato de variables separan guía, seguimiento y checkout.

Los snapshots son referencias de septiembre de 2026, no consultas en vivo de la configuración actual. Esta revisión no envía mensajes, no llama a clientes y no cambia conexiones ni flujos de producción.
