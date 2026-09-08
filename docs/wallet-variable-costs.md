# Billetera: consumo variable sin margen

Se excluyen las mensualidades de proveedores, servidores y suscripciones. No se reparten entre clientes. Las claves propias del comercio mantienen su tratamiento directo con el proveedor. Las cuentas de cortesía conservan la exención: su costo se registra para auditoría, pero lo asume Riverz.

## Qué cambia

- Reserva atómica del saldo disponible antes de las solicitudes pagadas. La liquidación registra el consumo, descuenta el costo y libera el sobrante en una transacción. Se conservan las fracciones de centavo.
- Anthropic se mide por petición, incluyendo respuestas descartadas, herramientas, caché y streaming completo. Un modelo sin tarifa no inicia consumo. Se eliminan los cobros agregados anteriores para evitar duplicados.
- Respaldo de texto, transcripción, TTS, Firecrawl y Apify pasan por contabilidad de consumo. Apify usa el recibo del run; para actores mensuales solo admite los cargos de uso itemizados. Firecrawl crawl usa creditsUsed, aunque falle o entregue contenido parcial.
- Los resultados inciertos conservan la reserva; no se inventa un cargo ni se reintenta a ciegas. El cron recupera recibos de Apify y Firecrawl y muestra los casos pendientes.
- Recarga automática con intento persistente e idempotencia Stripe. Una caída después del pago no crea un segundo cobro. Las comisiones deben estar disponibles antes de acreditar saldo utilizable.
- Reembolsos y disputas de las nuevas recargas reflejan sus transacciones reales de Stripe una sola vez. Un ajuste puede dejar deuda; impide nuevo consumo.
- Conciliación administrativa por operación y recibo inmutable. Permite corregir el costo en ambos sentidos. No importa facturas mensuales ni distribuye sus totales.

## Requisitos de activación

1. Aplicar `supabase/migrations/253_wallet_provider_usage.sql`. La credencial de administración disponible respondió HTTP 401 durante esta tarea; la migración NO se aplicó a producción.
2. Configurar las tarifas de consumo contratadas. No dividir una mensualidad por sus créditos incluidos:
   - `FIRECRAWL_USAGE_USD_PER_CREDIT`: costo de créditos de uso adquiridos.
   - `APIFY_PROFILE_MAX_USAGE_USD`: reserva máxima por perfil (mayor que cero, hasta USD 5); no es el precio final. Los límites de Apify dependen del modelo del actor y no garantizan un techo para todos los cargos de plataforma.
   - `ELEVENLABS_USAGE_USD_PER_CHARACTER`: costo variable del modelo activo, si se usa ElevenLabs.
   - `VOICE_STT_USD_PER_MIN`, `VOICE_TELEPHONY_USD_PER_MIN`: tarifas variables del stack/ruta activos. Esta implementación calcula por segundos; requiere contratos con esa granularidad. No habilitarla para destinos/tarifas con cargos de conexión o redondeos distintos sin incorporar esas reglas.
   - `AI_MODEL_USAGE_RATES_JSON`: sobrescrituras `{ "modelo": { "input": USD_por_millon, "output": USD_por_millon } }` para precios negociados/cambiados.
   - `NEXT_PUBLIC_APP_URL` y `VOICE_WORKER_SECRET` consistentes entre web y worker.
3. Desplegar web y `voice-worker/agent.py` de forma coordinada. El stack de voz medido admite Deepgram + Anthropic + Fish/ElevenLabs; configuraciones distintas se rechazan antes de empezar. Verificar las tarifas y el modelo de Fish activo contra su contrato antes de habilitarlo.
4. Activar el cron autenticado `/api/cron/wallet-conciliacion` cada cinco minutos en el programador existente. Las reservas pendientes aparecen en el resultado y en `/api/admin/wallet/conciliacion`; requieren revisión, no liberación automática.
5. Suscribir el webhook de Stripe a `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, además de los eventos existentes de pago/checkout. Verificar un pago y su comisión, reintento, reembolso y reversión en modo test.
6. Probar una llamada de extremo a extremo después de la migración y despliegue coordinado. La validación local no sustituye esa prueba.

El build de Render comprueba que existe el esquema nuevo y falla antes de sustituir la versión activa si falta. El commit inicial incluye `[skip render]` porque la base aún no está preparada.

## Conciliación

GET administrativo devuelve costos y reservas pendientes. POST autenticado con CSRF acepta:

```json
{
  "tipo": "consumo_variable",
  "operacionId": "id de operación",
  "reciboId": "identificador único del recibo",
  "costoUsd": 0.0123
}
```

El importe debe ser el costo atribuible a esa operación, excluidas las mensualidades. Las comisiones/impuestos de la compra de créditos de terceros y descuentos negociados requieren recibos o tarifas netas verificadas; no se infieren ni se agregan porcentajes arbitrarios. No hay sincronización automática de todas las facturas de todos los proveedores. Los consumos anteriores no se refacturan retroactivamente.

Las reservas previenen gasto concurrente no financiado, pero un proveedor puede reportar más consumo que el límite estimado. Ese costo se registra y bloquea nuevo gasto; no garantiza cobrar una deuda ni eliminar el riesgo de contracargos. Las cuentas de cortesía y las pruebas internas de plataforma siguen siendo costos asumidos por Riverz.

## Fuentes de unidades

- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
- Búsqueda Anthropic: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Groq Whisper large-v3: https://console.groq.com/docs/model/whisper-large-v3
- Fish Audio: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits
- Apify recibos de ejecución: https://docs.apify.com/api/v2/actor-run-get
- Firecrawl créditos de crawl: https://docs.firecrawl.dev/api-reference/v1-endpoint/crawl-get
