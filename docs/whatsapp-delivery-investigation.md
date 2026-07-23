# Entrega de mensajes iniciados por el negocio en WhatsApp Cloud API — investigación

Investigación técnica sobre por qué ciertos mensajes iniciados por el negocio no se
entregan, con fuentes oficiales de Meta/WhatsApp. Convención por afirmación:
**[DOC]** = texto oficial de Meta · **[INTERP]** = interpretación a partir de docs ·
**[NO-OFICIAL]** = BSP/foro/comunidad (marcado). Fechas indicadas donde la política
cambia. Última actualización: 2026-07-23.

---

## TL;DR (honesto)

1. La cuenta del caso está **sana**: `can_send_message=LIMITED`, `141010` (sin
   verificar), coexistencia y quality GREEN **no bloquean la entrega** — solo topan
   el volumen al tier de 250 (y el caso envía ~10/24 h). Verificar el negocio **no**
   mejora la entrega a números fríos.
2. El MARKETING (carrito) atascado en `sent` a un número **US (+1)** es la **pausa de
   marketing a EE.UU. de Meta (desde 2025-04-01)**: no-entrega **silenciosa**, no un bug.
3. La UTILITY a fríos AR que queda en `sent` para siempre es **TTL-drop** / **número
   no alcanzable (131026)** / **pacing de plantilla nueva (UNKNOWN)** — y a veces Meta
   **calla el motivo a propósito** (`failed` sin `errors[]`).
4. Las plantillas **NO** requieren ventana de 24 h abierta (mito). El "+54 9" AR
   normaliza al mismo `wa_id`. `131049` es **solo marketing** y **no es silencioso**.
5. El problema real de Riverz era de **visibilidad**: no capturaba el motivo crudo ni
   el `message_status`, no detectaba `sent` atascados, no mostraba la salud de la
   cuenta ni traducía los códigos. Todo eso se corrigió (ver §"Qué se implementó").

---

## Caso real

- WhatsApp Cloud API vía Tech Provider; número por **coexistencia** (app WhatsApp
  Business + Cloud API en el mismo número), onboardeado hace pocos días.
- `health_status`: `can_send_message=LIMITED`; entidad BUSINESS → error **141010**
  "The Business has not passed business verification"; `name_status=APPROVED`,
  `quality_rating=GREEN`, `throughput=STANDARD`, `code_verification_status=VERIFIED`.
- Plantillas: `nuevo_pedido` (UTILITY, APPROVED, quality_score=UNKNOWN), `tracking`
  (UTILITY, APPROVED), `carrito_abandonado` (MARKETING, APPROVED).
- Volumen ~10/24 h (muy por debajo de 250).
- Síntomas: (1) UTILITY entrega dentro de ventana; (2) la MISMA UTILITY falla o queda
  en `sent` a fríos AR; (3) `failed` a veces sin código, a veces ni `failed`;
  (4) comportamiento errático; (5) MARKETING atascado a un número US; (6) "+54 9" con o
  sin el 9 = mismo `wa_id`; (7) un AR recibió texto en sesión hace 2 días pero hoy las
  plantillas le fallan.

---

## Diagnóstico (rankeado) y mapeo por síntoma

| Síntoma | Causa más probable (documentada) | ¿Silencioso? |
|---|---|---|
| MARKETING a US +1 en `sent` para siempre | **Pausa de marketing a EE.UU.** (2025-04-01) `[DOC]` | Sí (sin error) |
| UTILITY a frío AR en `sent` eterno | **TTL-drop** ("asumir descartado") `[DOC]` / número no alcanzable (131026) / **pacing** de plantilla UNKNOWN | Sí / No |
| UTILITY a frío falla ~15 s | **131026** no entregable (no es WhatsApp / no aceptó ToS / versión vieja) `[DOC]` | No (`failed` con código) |
| `failed` sin `errors[]` | Meta retiene el motivo — **no documentado**, contradice el spec del webhook | `failed`, sin código |
| "+54 9" mismo wa_id | Normalización de Meta; llavear por `wa_id` | n/a |
| `LIMITED` + `141010` | Sin Business Verification → tier 250 (solo volumen) `[DOC]` | n/a |

**Descartado (con fuente):** la ventana de 24 h (mito; las plantillas entregan fuera de
sesión), `131049` (marketing-only y no silencioso), el cupo de 250 (envía ~10),
"warm-up" (no documentado), el "9" AR (normaliza), verificación como bloqueo de entrega
(solo topa volumen).

---

## A. Cuenta / Portfolio

- **141010 (business no verificado).** No está en la tabla pública de error-codes;
  aparece en la respuesta de `health_status` a nivel de la entidad BUSINESS.
  `[NO-OFICIAL]` para el string exacto. **No bloquea la entrega**: `LIMITED` = *"the node
  meets messaging requirements, but has some limitations"* `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/support/health-status/).
  La verificación es **una de tres vías de escalado** del cupo, no un requisito para
  enviar `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits).
- **Tiers (2025→2026):** 250 → 2.000 → 10.000 → 100.000 → ilimitado. Cuentan los
  **números únicos** a los que **entregás** fuera de la ventana de servicio en una
  ventana móvil de 24 h. Desde **2025-10-07** el límite es **por portfolio**, no por
  número `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/).
- **`can_send_message`:** AVAILABLE / LIMITED / BLOCKED. Solo **BLOCKED** = no puede
  enviar `[DOC]`. `account_review_status`: APPROVED/DEFERRED/PENDING/REJECTED;
  `business_verification_status`: VERIFIED/NOT_VERIFIED/PENDING/… (campo detrás de 141010)
  `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api).
- **Sin verificar** → tope práctico de **250** hasta verificar o acumular 2.000 entregas
  de calidad en 30 días. No hay un tier documentado **debajo** de 250 `[INTERP grounded in DOC]`.

## B. Número

- **Coexistencia:** throughput **fijo en 20 mps** (no escala a HIGH); desactiva algunas
  features (listas de difusión, grupos, etc.). **No** hay restricción documentada de
  entrega de plantillas a fríos por ser coexistencia `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).
- **quality_rating** GREEN/YELLOW/RED se calcula por feedback (bloqueos/reportes/mutes)
  de los **últimos 7 días** `[DOC]`
  (https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/).
  GREEN es óptimo; no es la causa.
- **Throughput** STANDARD (80 mps) vs HIGH (1.000). STANDARD/20 mps es lo normal en
  coexistencia `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput).
- **"Warm-up" / ramp-up de número nuevo: NO existe documentado** `[DOC-absence]`. Es
  folklore de BSP `[NO-OFICIAL]`. Lo que sí "muerde" a lo nuevo es el **pacing** de
  plantillas sin historial (§C).
- **Calidad del número ≠ calidad de la plantilla** (dos señales distintas) `[DOC]`.

## C. Plantillas

- **Categorías** UTILITY/MARKETING/AUTHENTICATION y re-categorización automática
  (UTILITY→MARKETING inmediato desde 2025-04-16) `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization).
- **quality_score** GREEN/YELLOW/RED/**UNKNOWN**. UNKNOWN = *"quality score is still
  pending… yet to receive user feedback or read-rate data"* → plantilla nueva `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality/).
- **PACING (clave):** *"valid for marketing and utility templates"* → **también aplica a
  UTILITY**. *"Newly created templates… or don't have a GREEN quality rating are
  potentially subject to pacing."* La respuesta de envío devuelve
  `message_status: "held_for_quality_assessment"`; feedback positivo → se libera y envía;
  negativo → **se descarta con `failed` code `132015`**. `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pacing/).
  **Importante:** el pacing retiene ANTES del `sent`; **no** deja algo colgado en `sent`.
- **PAUSING** (3 h / 6 h / disabled) por RED. No aplica (GREEN). `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pausing/).

## D. Destinatario

- **No hay endpoint para validar si un número tiene WhatsApp** en Cloud API — se manda y
  se descubre en la entrega `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).
  El `wa_id` devuelto **no garantiza** que sea usuario real (`[NO-OFICIAL]` el término
  "optimistic"). Si no está en WhatsApp → **131026** en la entrega.
- **Opt-in:** requisito de **política**, no gate técnico. No hay campo de API; WhatsApp no
  lo almacena `[DOC]` (https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
  · https://whatsappbusiness.com/policy/).
- **Ventana de 24 h — MITO DESMENTIDO:** *"template messages are the only message type
  that can be sent outside of a customer service window."* Las plantillas **NO** requieren
  sesión abierta `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing ·
  .../messages/send-messages).
- **Cap por-usuario de MARKETING:** `131049` "not delivered to maintain healthy ecosystem
  engagement" y `131050` (opt-out). **Solo marketing** `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits).

## E. Filtrado / "healthy ecosystem"

- El cap por-usuario **131049** es **solo MARKETING**, **agregado entre TODOS los
  negocios**, y **NO es silencioso** (emite `failed` con 131049) `[DOC]`.
- El **único** filtro documentado que toca UTILITY es el **pacing** (§C): retiene
  (`held_for_quality_assessment`) o descarta (`failed 132015`) — no es un `sent` colgado.
- **Un filtro verdaderamente silencioso de UTILITY** (queda en `sent`, nunca `delivered`,
  nunca `failed`) **NO está documentado por Meta** para ninguna categoría `[NO-OFICIAL/INTERP]`.

## F. Códigos de error y estructura del webhook

- **Esquema del status webhook** `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status):
  `statuses[]` con `id`, `status` (sent/delivered/read/failed), `timestamp`,
  `recipient_id` (el `wa_id` normalizado), `conversation`, `pricing`, y **`errors`**
  *"only included if failure to send or deliver message"*.
- **`sent`** = *"successfully sent from our servers"*; **`delivered`** = *"delivered to
  the user's device"*. Son eventos distintos y `sent`→`delivered` **no está garantizado**.
- **`failed` sin `errors[]`** contradice el spec → **Meta retiene el motivo**
  (no documentado) `[INTERP]`.
- **`sent` para siempre** = **TTL-drop**: *"If you do not receive a `delivered` webhook
  before the TTL is exceeded, assume the message was dropped."* `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).
- **130472** "part of an experiment" = holdout de marketing; llega como `failed` con
  código `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/support/experiments/).

### Tabla de códigos (los relevantes)

| Código | Significado | ¿Silencioso? | Acción |
|---|---|---|---|
| 131026 | No entregable (no es WhatsApp / no aceptó ToS / versión vieja) | No (`failed`) | Validar número |
| 131047 | +24 h desde la última respuesta | No | Usar plantilla (ya se hace) |
| 131049 | Cap por-usuario de **marketing** | No (`failed`) | Esperar 24 h; marketing only |
| 131050 | Usuario optó salir de marketing | No | No reintentar |
| 130472 | Holdout de experimento de marketing | No (`failed` con código) | Que el user escriba primero |
| 132015 | Plantilla pausada/retenida por baja calidad | No | Mejorar calidad |
| 131048 / 131056 | Spam / par emisor-receptor | No | Bajar frecuencia |
| 141006 / 131042 | Método de pago | No | Configurar pago en WhatsApp Manager |
| 141010 | Negocio sin verificar (health_status) | n/a | Solo sube cupo |
| **(sin código)** | **Pausa marketing US** y **TTL-drop** | **Sí, `sent` eterno** | Gate cliente-side / detectar timeout |

## G. Reglas por país/región

- **MARKETING a EE.UU. (+1):** *"WhatsApp does not currently deliver marketing template
  messages to WhatsApp users with United States phone numbers."* Desde **2025-04-01**.
  Es **no-entrega**, sin código de error → `sent` indefinido `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits).
- **Argentina "+54 9":** el `recipient_id`/`wa_id` es la identidad **normalizada**;
  Meta puede modificar el prefijo (documentado para Brasil/México; para AR ya no figura
  en docs vigentes tras el sunset de On-Premises 2025-10-23) `[NO-OFICIAL]`. Regla
  práctica: **llavear por `wa_id`**, no por el string crudo.
- **Excluidos del cap de marketing:** EEA, Reino Unido, Japón, Corea del Sur (siguen
  recibiendo marketing; es exclusión del **cap**, no de la entrega — distinto del caso US)
  `[DOC]`.

## H. Tech Provider / Solution Partner

- En el modelo **Tech Provider**, el **cliente** aporta su propio **método de pago**,
  su **Business Verification** y el **display name** `[DOC]`
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview).
- El modelo de partner **no** afecta la **entrega** a fríos: la entrega la gobiernan
  categoría, país, experimento, ventana, calidad y tier — no quién onboardeó `[INTERP]`.

---

## Las 7 preguntas, cerradas

1. **¿Por qué una UTILITY falla/retiene a fríos con GREEN y bajo cupo?** No por los
   límites de cuenta (solo topan volumen). Sí por **131026** (no alcanzable), **pacing**
   de plantilla UNKNOWN (→`132015`), o **TTL-drop**. Nunca 131049 (marketing) ni la ventana.
2. **¿Un número nuevo/coexistencia tiene la entrega limitada por reputación?** No hay
   "warm-up" documentado. Coexistencia = 20 mps + features off. Lo real es el **pacing**
   de plantillas sin historial; se destraba acumulando engagement positivo (UNKNOWN→GREEN);
   plazo no documentado.
3. **¿Por qué `failed` sin código o `sent` eterno?** `failed` sin `errors[]` = Meta calla
   el motivo (no documentado). `sent` eterno = TTL-drop ("asumir descartado"). Detección:
   la app debe **capturar el crudo** + un **barrido de `sent` vencidos**, porque Meta puede
   no avisar nunca.
4. **¿Las plantillas necesitan ventana de 24 h?** **NO.** Son el único tipo que entrega
   **fuera** de sesión. Mito desmentido.
5. **¿Verificar el BM mejora la entrega a fríos?** **NO.** Solo sube el cupo, quita el
   141010 y habilita escalado/más plantillas. Verificación ≠ mejor entrega a fríos.
6. **¿Es la coexistencia?** No para la entrega. Solo throughput/features.
7. **¿Qué mueve la aguja vs qué no?** **Mueve:** destinatarios que sean WhatsApp reales +
   opt-in; construir historial de plantilla (UNKNOWN→GREEN) para salir del pacing; para
   US no mandar marketing; **capturar `message_status`+payload crudo+detección de `sent`
   atascado**; llavear por `wa_id`. **No mueve** la entrega a fríos: verificar el negocio,
   "warm-up", agregar el "9".

---

## Qué se implementó en Riverz (mapa a los hallazgos)

- **Capturar el motivo real** (§F): el webhook guarda `error_code`, el payload crudo
  (`meta_status_raw`) y el texto de Meta; el envío captura `message_status`
  (`held_for_quality_assessment`) y `wa_id`; `MetaApiError` conserva subcode/detail/fbtrace.
  Archivos: `src/app/api/whatsapp/webhook/route.ts`, `src/lib/channels/whatsapp/adapter.ts`,
  `src/lib/whatsapp/meta-api.ts`, `src/lib/automations/meta-send.ts`, `src/app/api/messages/send/route.ts`.
- **Mapa de códigos localizado es/en** (§F): `src/lib/whatsapp/delivery-errors.ts` +
  `src/lib/i18n/messages/deliveryErrors.ts`; la bandeja lo muestra traducido
  (`src/components/inbox/message-bubble.tsx`).
- **Watchdog de `sent` atascado** (§F/TTL-drop): `src/app/api/cron/delivery-watchdog/route.ts`
  marca `delivery_unconfirmed_at`; la bandeja muestra "enviado, sin confirmar".
- **Panel "Estado de WhatsApp"** (§A/B): salud/tier/calidad persistidos y mostrados;
  chequeo también en connect manual. `src/lib/whatsapp/account-health.ts`,
  `src/components/settings/channels-panel.tsx`.
- **Calidad/pacing de plantillas** (§C): el sync trae `quality_score`+`meta_status`; la
  UI marca UNKNOWN/pausada. `src/app/api/whatsapp/templates/sync/route.ts`, `plantillas/page.tsx`.
- **Webhooks de estado/calidad de plantilla** (§C): handlers
  `message_template_status_update` / `message_template_quality_update`.
- **Gate de marketing a EE.UU.** (§G): `isUsPhone` frena marketing a +1 US en
  automatizaciones y campañas con motivo claro, en vez de `sent` fantasma.
- **Llavear por `wa_id`** (§G): se persiste el `wa_id` en entrada y salida.

**Requiere acción manual (fuera de código):**
- Aplicar la migración `111_message_delivery_diag.sql` (Supabase Management API).
- En el App Dashboard de Meta, suscribir los campos de webhook
  `message_template_status_update` y `message_template_quality_update` (y, si se aprueban,
  `phone_number_quality_update` / `account_update`) para que los handlers reciban eventos.
- Completar **Business Verification** del portfolio (sube el cupo; no destraba fríos).

---

## Plan de acción priorizado (mueve la aguja → no la mueve)

1. **Asegurar destinatarios reales + opt-in** (evita 131026 y quema de calidad).
2. **Construir historial de la plantilla** para pasar UNKNOWN→GREEN y salir del pacing.
3. **No mandar marketing a EE.UU.** (ya gateado): usar utility/auth o abrir ventana.
4. **Usar la visibilidad nueva** (motivo real + `sent` sin confirmar + estado de la
   cuenta) para decidir con datos, no a ciegas.
5. **Verificar el negocio** — útil para el cupo/OBA, **pero no** para la entrega a fríos.
