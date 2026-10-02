# Contrato técnico de Leadsales

Estado comprobado el 2 de octubre de 2026. La migración CSV sigue disponible; el conector nativo requiere su contrato técnico actual, no rutas inventadas.

La investigación delegada con Firecrawl consultó trece búsquedas, una búsqueda para desarrolladores, cuatro mapas y siete lecturas públicas. No creó cuentas, compró claves, contactó a Leadsales ni consultó datos de clientes. El enlace junto a «documentación completa» en la pantalla de API Key no pudo recuperarse desde esas fuentes.

| Evidencia pública | Implicación para el conector |
| --- | --- |
| [docs.leadsales.services](https://docs.leadsales.services/) redirige al [artículo de API pública](https://leadsales.io/blog/leadsales-api-publica/), publicado el 13 y modificado el 23 de septiembre de 2026. El artículo describe desarrollo/acceso inicial. | No contiene base URL, autenticación, esquemas o paginación implementables. |
| [Generar y usar API Token](https://iozssqbrp.gleap.help/es/articles/9135023-%C2%BFcomo-generar-y-usar-tu-api-token-en-leadsales) describe suscripción activa, permiso del dueño y clave de pago; muestra PublishableKey/SecretKey y un acceso a documentación completa. | Existe evidencia de una oferta de API, pero no identifica el header, endpoints o contrato de datos. No se extrajeron claves. |
| [Qué es la API pública](https://iozssqbrp.gleap.help/es/articles/9135017-%C2%BFque-es-la-api-publica-de-leadsales-y-como-usarla) menciona leads, embudos y usuarios. | No acredita cobertura de historial/adjuntos, fin de paginación o límites por operación. |
| [Términos, sección 8.4](https://leadsales.io/terminos-y-condiciones/) describe campos y 100.000 solicitudes sin periodo técnico identificado. | No permite fijar una frecuencia segura ni interpretar el límite como diario o mensual. |

Las fuentes comerciales y de ayuda difieren; eso no demuestra que la API no exista. La consulta pendiente al dueño pide únicamente la URL técnica/OpenAPI, sin secretos. Con ese contrato se valida autoridad de cuenta, lectura GET, paginación completa, límites y alcance de contactos/historial antes de conectar la cola privada y la revisión humana existentes. No se declara terminado Leadsales mediante un stub o el importador CSV.
