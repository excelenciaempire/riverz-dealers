# Análisis competitivo Riverz 2026 — Meta Business Agent + 22 competidores

> **Fecha:** 2026-06-22 · **Autor:** Estrategia (research multi-agente) · **Estado:** vivo
> **Origen:** análisis del video *"Meta volvió obsoletos a los que venden chatbots de WhatsApp… ¿y ahora?"* de **Kevin Beller** (`youtube.com/watch?v=I1wE_WzGRCE`, t=728s) + investigación exhaustiva de competidores.
> **Método:** el video se analizó con **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`, ingiriendo el YouTube directo — audio + pantalla, 92.6k tokens de video) → ver §1.0 y Anexo A. La competencia, con un workflow de 30 agentes (22 competidores con fuentes primarias + verificación adversarial en 3 lentes). Cada afirmación sobre Riverz está verificada contra el código.

---

## TL;DR

**¿Meta nos volvió obsoletos? No — y el propio video lo dice.** El video de **Kevin Beller** (analizado con Gemini 3.1 Pro) tiene un título alarmista pero una tesis **optimista y sofisticada**: Meta **commoditiza el bot simple** con su *Meta Business Agent Platform*, pero *"el negocio apenas empieza"*; hay que **evolucionar hacia la capa de orquestación / integración / consultoría que Meta no puede cubrir** — que es, casi literalmente, lo que Riverz ya es. Y enumera **3 "grietas" de Meta** que son nuestras 3 aperturas estratégicas (ver §1.0). Por separado, el ban de Meta del **15-ene-2026** prohíbe **chatbots de propósito general** (ChatGPT, Copilot, Perplexity sobre la WABA), **no** a un CRM cuya IA contesta por *un* negocio sobre *ese* negocio — Riverz está **del lado permitido** (viento a favor que extermina a la competencia commodity).

**Lo que sí muere:** el pitch *"te pongo una IA en tu WhatsApp"*. Eso ahora es gratis dentro de la app. Nuestro módulo de agente de IA es la parte **más expuesta** de Riverz.

**Lo que no muere y es nuestro foso:** la **plataforma de comercio-operaciones** — pedido contra-entrega real en Shopify, bandeja unificada de 7 canales, consola de equipo, campañas, flujos, atribución de ingresos e incrementalidad con holdout. Meta **no** construye eso para una pyme.

**Veredicto adversarial (3 lentes):** *compliance* = **largely-safe** (alta confianza) · *producto* = **partially-threatened** · *mercado* = **partially-threatened**. No obsoletos; amenazados en el piso y en distribución; intactos en la plataforma.

**Movimiento:** dejar de vender "un chatbot" y vender **el sistema operativo de comercio conversacional para tiendas Shopify de LatAm**, coexistiendo **encima** de Meta. Cerrar 6 brechas P0 antes de lanzar.

---

## 1. Veredicto sobre Meta — ¿nos volvió obsoletos?

### 1.0 Lo que realmente dice el video (analizado con Gemini 3.1 Pro)

El video es de **Kevin Beller** (comunidad "Vibe Community VIP" en Skool; enseña a construir SaaS/agencias con *Vibe Coding* y *Spec-Driven Development*). Va dirigido a **Tech Providers, agencias de automatización, freelancers y creadores de SaaS** que venden chatbots/integraciones de WhatsApp. Capítulos (timestamps reales):

- **00:00–01:04** — El "susto": Meta lanza su agente embebido; cae de peso a las agencias. Promete análisis honesto.
- **01:04–01:51** — El agente **actúa**, no solo responde: usa catálogo, **cierra ventas y cobra en el chat**, se integra con plataformas y hace *handoff* a humano.
- **01:51–02:55** — **Jugada maestra: Usernames en WhatsApp** (como Telegram) + **buscador interno** para descubrir negocios sin tener su número. Meta quiere que los negocios dependan menos de FB/IG para ser descubiertos.
- **02:55–04:32** — **No será gratis**: hoy gratis como gancho; pronto cobran por **consumo de tokens** (LLM de Meta) + suscripciones, encima del costo de mensajes de plantilla.
- **04:32–08:07** — **Las 3 grietas de Meta** (ver tabla abajo).
- **08:07–10:57** — *"¿Se acabó? No, apenas empieza."* El **99%** de los negocios aún no automatiza; Meta **normaliza** el uso de IA → sube la demanda general; pero el dueño promedio no sabrá configurarlo.
- **10:57–13:08** — **El cambio de juego:** el bot simple de Q&A muere; la demanda sube hacia **automatizar procesos internos, conectar sistemas complejos (CRMs/ERPs) y consultoría de IA.**
- **13:08–15:51** — Meta **no eliminó a los Tech Providers** porque no puede cubrir los procesos difíciles (muestra la curva de adopción: aún falta entrar la mayoría del mercado).
- **15:51–16:58** — Promo de su comunidad.

**El minuto 12:08 (t=728s, a donde apunta el enlace que mandaste):** sección titulada en pantalla **"Conectar todo el negocio a la IA"**. Kevin argumenta que las empresas necesitan a alguien que **conecte los sistemas externos fuera del ecosistema de Meta** — CRMs, ERPs, inventarios, voz, omnicanalidad — y define al profesional de IA como un **"gran director de orquesta"** de todas las herramientas/microservicios. **Esto es, palabra por palabra, la tesis de Riverz.** El usuario marcó justo este punto.

**Las 3 grietas de Meta (del video) = nuestras 3 aperturas estratégicas:**

| Grieta que el video le ve a Meta | Apertura para Riverz |
|---|---|
| **1. Caja cerrada, sin MCP abierto** — solo integraciones preconstruidas (Shopify, Zendesk, **Shopee**) | Riverz es la capa **abierta** que integra lo que el negocio ya usa (Shopify hoy; Dropi/CRMs/ERPs en roadmap). El "director de orquesta". |
| **2. Privacidad — Meta usa las conversaciones para su máquina de ads** (política en pantalla **18-dic-2025**) | **Ángulo de privacidad nuevo:** con Riverz, los datos del cliente **no alimentan los ads de Meta**; el merchant es dueño de su data (DPA con Anthropic, sin uso publicitario). Mensaje fuerte para negocios con data sensible. |
| **3. No es a medida + la data debe vivir en Meta** — hay que subir el catálogo a Meta; negocios con miles de SKUs en CRMs externos no pueden sincronizar (ejemplo: **ferretería** con precios que cambian a diario) | Riverz **sincroniza el catálogo Shopify** y mantiene la data en el sistema del negocio; maneja catálogos grandes/complejos y conocimiento product-first compilado. |

**Conclusión del video aplicada a nosotros:** Kevin literalmente le dice a su audiencia que se conviertan en lo que Riverz ya es (orquestador/integrador, no vendedor de bots simples). El video **no es una amenaza para Riverz: es una validación de tesis** — y de paso nos regala el guión de ventas (las 3 grietas) y confirma que el mercado *apenas empieza*.

> ⚠️ Matiz: el video habla del producto **"Meta Business Agent Platform"** y de la política de datos del **18-dic-2025**; el **ban de chatbots de propósito general del 15-ene-2026** (ChatGPT/Copilot/Perplexity) es un evento **distinto** que encontramos en la investigación y que refuerza nuestro lado-permitido (§1.2). Ambos coexisten.

### 1.1 Qué lanzó Meta (los hechos)

**Meta Business Agent** — anunciado/desplegado globalmente el **3 de junio de 2026** en la conferencia *Conversations 2026* (Londres), tras ~2 años de pruebas (India, México). Es un agente de IA **nativo** dentro de WhatsApp/Messenger (Instagram en expansión) que:

- responde preguntas del negocio, recomienda productos del catálogo, agenda citas, califica leads, cierra ventas y hace **handoff a humano**;
- se configura en ~10 min, **gratis para empezar**, entrenado con chats pasados + página de Facebook + catálogo + FAQs + sitio web;
- tiene una **Meta Business Agent Platform** (enterprise) para construir/personalizar/desplegar agentes a escala, con integraciones nativas preconstruidas a **Shopify, Zendesk y Shopee**;
- **cobra dentro del chat** de WhatsApp (cierra la venta y procesa el pago en la conversación);
- **WhatsApp Usernames + buscador interno** (per el video): los usuarios podrán encontrar negocios por nombre de usuario, sin tener el número — Meta reduce la dependencia de FB/IG para el descubrimiento;
- escala declarada: **1M+ negocios** ya lo usan; 1B+ conversaciones negocio-cliente diarias;
- precio: gratis ahora; luego **consumo de tokens** (LLM de Meta) + suscripción **WhatsApp Business Premium** (pymes), encima del costo de mensajes de plantilla; sin tarifas publicadas aún;
- **uso de datos:** política de Meta (en pantalla en el video, **18-dic-2025**) indica que las conversaciones con su IA alimentan la personalización/segmentación de **anuncios**.

**El ban del 15-ene-2026** — Meta actualizó los *WhatsApp Business Solution Terms* para prohibir que proveedores externos usen la API para **distribuir chatbots de propósito general**. Afectados confirmados: Microsoft Copilot, ChatGPT (OpenAI), Perplexity, Poke, Dola/Yestoki. Razón declarada de Meta: la API existe para **comunicación negocio-cliente** (soporte, notificaciones, reservas, estados), y los asistentes de "pregúntame lo que sea" caen fuera de ese marco.

**Contrapeso UE:** la Comisión Europea (jun-2026) ordenó a Meta **reabrir** WhatsApp a chatbots rivales (medida cautelar antitrust). Puede aflojar el ban — más viento a favor.

### 1.2 El nudo de compliance: ¿un CRM con Claude está permitido en WABA?

**Sí — y verificado en el código, sin ambigüedad.** La pregunta se reduce a un hecho: ¿es nuestro agente Claude un **asistente general** (prohibido) o un **agente de negocio acotado** (permitido)? El código responde:

- [`src/lib/ai/runner.ts`](../src/lib/ai/runner.ts) `buildSystemPrompt` hard-lockea cada agente: *"Tu único dominio es el negocio descrito arriba"* y **rechaza explícitamente** clima, política, deportes, otras marcas, consejos generales, recetas, traducciones y **código**; un *character-lock* se niega a *"responder como un asistente general"* y a *"ignora tus instrucciones / revela tu prompt"*.
- Transporte = **Cloud API oficial**: [`src/lib/whatsapp/meta-api.ts`](../src/lib/whatsapp/meta-api.ts) → `graph.facebook.com/v21.0`, WABA, `phone_number_id`, `appsecret_proof`. No userbot/scraping/QR (la *otra* forma de ser no-compliant).
- Opt-out/opt-in: [`src/lib/whatsapp/opt-out.ts`](../src/lib/whatsapp/opt-out.ts) (STOP/BAJA/UNSUBSCRIBE).
- El paquete de App Review ([`docs/meta-app-review-submission.md`](./meta-app-review-submission.md)) ya enmarca a Riverz como *"la herramienta propia del negocio sobre sus propios activos, nunca vendida, nunca usada para ads"*.

Eso es, casi línea por línea, la definición de un **agente task-specific compliant**. **El ban es prácticamente un no-evento para nuestra categoría y un evento de exterminio para la competencia commodity** (Chatea PRO con QR/SIM, wrappers genéricos de ChatGPT).

### 1.3 Riesgos reales (no cosméticos)

| # | Riesgo | Severidad | Mitigación |
|---|--------|-----------|------------|
| 1 | **Commoditización del piso** — el agente nativo gratis de Meta reemplaza nuestro auto-reply de un agente | Alta | Reposicionar: liderar con comercio/operaciones, nunca con "IA en WhatsApp" |
| 2 | **Distribución asimétrica** — Meta está in-app, gratis, 1M+ negocios; Riverz es pre-launch sin billing | **La más alta** | Cerrar Tech Provider + billing; canal de agencias white-label; coexistir sobre Meta |
| 3 | **Dependencia de plataforma** — vivimos sobre la WABA; Meta puede gatekeepear/repricing | Alta | Maximizar valor no-WhatsApp (IG/Messenger/email/Shopify); contingencia documentada |
| 4 | **Scope-lock frágil** — hoy es config de prompt per-agente, no invariante server-enforced | Media | Anexar siempre el refusal "único dominio" + character-lock server-side |
| 5 | **Encroachment up-stack** — la Platform de Meta ya nombra Shopify; si Meta añade creación de pedidos, el foso #1 se estrecha | Media-alta | Profundizar contra-entrega más allá de lo que Meta modelaría (cobranza, novedades, cash) |
| 6 | **Reframe de precio** — "gratis para empezar" resetea expectativas en el mercado pyme más sensible al precio | Alta | Pricing anclado en ROI (checkouts recuperados, ingresos atribuidos), no por-asiento |

### 1.4 Qué hacemos MEJOR que Meta native y las herramientas propias de Facebook

| Capacidad | Meta Business Agent | Riverz | Evidencia en código |
|---|---|---|---|
| Pedido **contra-entrega** / pago pendiente | ❌ (checkout-tarjeta-primero) | ✅ crea pedido real en Shopify | [`shopify/create-order.ts`](../src/lib/shopify/create-order.ts) `financial_status:'pending'` |
| Bandeja multicanal unificada + email | ❌ (per-canal, sin email) | ✅ 7 canales incl. Gmail/Outlook | [`channels/types.ts`](../src/lib/channels/types.ts) |
| Consola de equipo (asientos/roles/asignación) | ❌ | ✅ | reglas de asignación, workspaces |
| Broadcasting/campañas salientes | ❌ (reactivo) | ✅ con tracking + segmentación | módulo de broadcasts |
| Flujos visuales condicionales | ❌ (deliberadamente superficial) | ✅ 12 tipos de nodo | flow builder |
| Incrementalidad con holdout | ❌ (solo ad-attribution amurallada) | ✅ uplift causal treatment-vs-control | [`instagram-agent/attribution.ts`](../src/lib/instagram-agent/attribution.ts) |
| Atribución de ingresos cross-herramienta | ❌ | ✅ `/metricas` por broadcast/flujo/automatización/IG | módulo de atribución Shopify |
| Conocimiento product-first con guardrails | Superficial (FAQ/catálogo) | ✅ `never_say`/`escalation`/`health_sensitive` | [`products/training-material.ts`](../src/lib/products/training-material.ts) |

### 1.5 Postura recomendada: coexistir ENCIMA de Meta

No pelear la respuesta inbound — **ser la capa que Meta no construirá para pymes LatAm.** Un comerciante puede correr Meta Business Agent como first-response **y** Riverz como sistema operativo de comercio. Eso convierte a Meta de competidor en **canal de educación de mercado que nos califica leads gratis**:

> *"Meta probó que todo negocio necesita un agente de IA — y de paso eliminó a la mitad de nuestros competidores. Riverz es la versión integrada, multicanal y conectada a tu tienda: pedidos contra-entrega reales, bandeja de 7 canales, campañas y atribución de ingresos que el agente nativo de Meta no puede dar."*

---

## 2. Mapa competitivo (22 competidores, 4 tiers)

Verificado con fuentes primarias (sitios, pricing pages, reviews G2/Capterra/Shopify, reporting 2025-2026). Pricing en la moneda original.

### Tier A — Rivales LatAm-nativos (competencia #1 por el mismo comerciante Shopify/COD)

| Competidor | Origen | Pricing | Killer feature | Qué nos falta vs ellos |
|---|---|---|---|---|
| **ManyChat** | SF/global | Free **25 contactos** (recortado de 1,000 en mar-2026, backlash masivo); Pro ~$29; Business ~$69 | **Comment-to-DM**: keyword en comentario IG/FB → reply público + DM privado con link | **Comment-to-DM auto-trigger**, story-reply, "say hi to new followers", SMS/email/TikTok/Telegram, marketplace de plantillas |
| **Lucid Bot** | Medellín 🇨🇴 | Desde **US$44/mo** (20k contactos), **BYOK** (el merchant trae su key OpenAI/Claude) | Envío masivo + automatización LatAm + **Marca Blanca** | Auto-DM-on-comment, voz **ElevenLabs/TTS**, **white-label**, integraciones COD (**Dropi, Effi, Mastershop, Rocketfy**), BYOK multi-LLM |
| **Chatea PRO** | 🇨🇴 (ecosistema Dropi) | Start $49 → Master $399 (gate por bots/contactos/miembros) | Servicio gestionado + **integración Dropi** (COD + novedades) | **Integración Dropi nativa**, capa done-for-you, bots pre-entrenados <15 min. ⚠️ *Ellos usan QR/SIM no-oficial → alto riesgo de ban (nosotros WABA oficial)* |
| **Leadsales** | Guadalajara 🇲🇽 | Basic $97 → Advanced $247; AI "Lead Agent" add-on aparte | **Pipeline Kanban** + envío masivo por etapa de funnel | **Kanban de ventas**, app móvil, envío por etapa de pipeline |
| **Cliengo** | Buenos Aires 🇦🇷 | Starter $45 → Business $259 | Chatbot web + WhatsApp lead-gen, ~13k clientes | Widget web-chat, app móvil, integración Google Ads, conectores CRM |
| **Clientify** | Almería 🇪🇸 | Solo €39 → Enterprise €99; **AI add-on aparte** | CRM all-in-one es/LatAm (Kanban, email mktg, landing, lead scoring) | **Kanban**, email marketing+A/B, landing builder, VoIP, lead scoring, app móvil |
| **Treble.ai** | Bogotá 🇨🇴 (YC S19) | Quote-based (estimado $99→$249→custom) | Automatización WhatsApp + **HubSpot/Salesforce** enterprise | Conectores **HubSpot/Salesforce**, WhatsApp Forms, A/B testing, send-time optimization, CTWA |

**Lectura del Tier A:** son la prioridad. La brecha que **todos** explotan y nosotros no: **comment-to-DM auto-trigger** (ManyChat, Lucid Bot) y **pipeline Kanban** (Leadsales, Clientify). La oportunidad inmediata: el recorte de free tier de ManyChat (1,000→25) generó una **ventana de captura** de clientes furiosos.

**Dónde ya ganamos (Tier A):** conocimiento product-first con Claude *managed* (Lucid Bot es BYOK; ManyChat lee 1 URL), **creación de pedidos** end-to-end (ninguno crea pedidos), incrementalidad con holdout (nadie), es/en nativo (ManyChat tiene localización débil documentada), WABA oficial (Chatea es QR/SIM con riesgo de ban), UX premium (la app Shopify de Lucid Bot está **2.4/5** con quejas de soporte).

### Tier B — BSPs globales / IA enterprise

| Competidor | Origen | Pricing | Qué nos falta vs ellos |
|---|---|---|---|
| **Yalo** | CDMX 🇲🇽 | Custom, ~US$500k/año (enterprise) | Comercio B2B distribución (tienda-a-tienda), ERP/OMS, pagos in-chat |
| **Botmaker** | Buenos Aires 🇦🇷 | Standard $149 → Pro $499 (por conversaciones) | **Voice/Callbots**, Mailbots, Mercado Libre/Telegram/Apple/Google channels, agent co-pilot, app móvil |
| **Respond.io** | KL 🇲🇾 | Starter $79 → Advanced $279 | **Voice AI agents**, TikTok/Telegram/Viber/LINE/SMS, widget web, SSO/ISO 27001, pipeline |
| **Wati** | HK 🇭🇰 | Growth ~$49 → Business ~$249 (+markup por mensaje) | WhatsApp Pay/checkout in-chat, **WhatsApp Calling**, SMS/RCS, app móvil, 100+ conectores, IG comment automation |
| **Interakt** | India 🇮🇳 (Jio) | ~$12 → $69 + AI add-on ~$115 | WhatsApp Pay (UPI), **CTWA Ads Launcher con ROAS dashboard**, WooCommerce, voz |
| **Zoko** | Bangalore 🇮🇳 (YC) | Starter $49.99 → Max $499.99 | **Catálogo WhatsApp / shopping in-chat**, COD order-verification empaquetado, BSP status, billing |

**Dónde ganamos (Tier B):** somos SMB/mid-market self-serve premium con **creación de pedidos COD nativa** (Wati/Zoko son tarjeta-primero), bandeja multicanal real, incrementalidad, es/en LatAm-first (vs DNA India/global). No competir de frente en enterprise (Yalo/Botmaker); ganarles en time-to-value y precio.

### Tier C — No-code bot builders

| Competidor | Origen | Pricing | Qué nos falta vs ellos |
|---|---|---|---|
| **Landbot** | Barcelona 🇪🇸 | Starter €40 → WhatsApp Pro €200 | **Widget web-chat** / landing conversacional, datastore "Tables", analítica por-nodo (drop-off), nodo GPT genérico in-flow |

**Dónde ganamos:** tenemos 12 nodos + `ai_intent` + `shopify_lookup` + `http_fetch` + authoring asistido por IA, **más** la capa de comercio/CRM encima. Landbot es solo el builder. (Nota P1: nos falta el **widget web-chat**, que Landbot/Cliengo/Tidio sí tienen.)

### Tier D — Multi-mercado expandiéndose a LatAm ⚠️ vigilar

| Competidor | Origen | Pricing | Qué nos falta vs ellos |
|---|---|---|---|
| **Pancake** | Hanoi 🇻🇳 → Brasil/Colombia | Freemium + ~US$22-165 (POS/Botcake/Webcake gratis) | **POS omnicanal** + inventario multi-marketplace, **livestream commerce**, integraciones de envío, Zalo/TikTok/LINE, **apps móviles**, site builder gratis, e-invoicing |

**Pancake** tiene **260k+ negocios** y el arsenal más grande de todos, ahora en Brasil/Colombia — el único con escala probada entrando a nuestra turf. **Dónde ganamos:** IA Claude *managed* (ellos BYO-OpenAI-key), creación de pedidos COD, incrementalidad, email en la bandeja, es/en LatAm-first profundo (ellos vietnamita-first), UX premium vs su reputación de "potente-pero-complejo".

### Otros perfilados (referencia)
**Kommo** (ex-amoCRM, ruso/global, $15-45/user/mo, fuerte en LatAm vía agencias, **Kanban + 50 AI agents** add-on) · **360dialog** (Berlín, BSP no-markup, €49-249/número, atribución cross-provider 360Pilot) · **Gupshup** (India, BSP Tier-1, ACE LLM propio, RCS/voz) · **Zenvia/Sirena** (Brasil, NASDAQ:ZENV, CPaaS SMS/RCS/email/WhatsApp Calling, CDP) · **Charles** (Berlín, e-commerce europeo, ~€349-2,500/mo, carruseles WhatsApp, LLM-agnóstico) · **Tidio** (Polonia, Lyro AI con **garantía de 50% resolución**, widget web, $0-749) · **Aivo** (Córdoba 🇦🇷, ex-líder LatAm CX, ahora Engageware/US enterprise, voice/IVR).

**Patrón de brechas recurrentes** (lo que más competidores tienen y nosotros no, en orden de frecuencia):
1. **Pipeline/Kanban de ventas** — Leadsales, Kommo, Clientify, Respond.io, Cliengo
2. **App móvil nativa** — Pancake, Leadsales, Clientify, Cliengo, Botmaker, Wati, Zenvia
3. **Comment-to-DM / story-reply automation** — ManyChat, Lucid Bot, Wati
4. **Billing self-serve / tiers públicos** — *todos* (nosotros pre-launch sin Stripe)
5. **Canales extra** (SMS/RCS, Telegram, TikTok, voz/WhatsApp Calling, widget web) — Respond.io, Botmaker, Wati, Gupshup, Zenvia
6. **Conectores CRM** (HubSpot/Salesforce/Zapier) — Treble, Respond.io, Wati, 360dialog
7. **Integraciones COD/fulfillment LatAm** (Dropi/Effi/Mastershop/Rocketfy) — Lucid Bot, Chatea PRO
8. **Atribución CTWA** (Click-to-WhatsApp Ads → ROAS) — Interakt, 360dialog, Treble

---

## 3. Qué construir / mejorar — roadmap priorizado

Effort: **S** (días) / **M** (1-3 sem) / **L** (1-2 meses).

### P0 — AHORA (neutralizar Meta + cerrar brechas que cuestan ventas hoy)

| # | Feature | Brecha que cierra | Effort | Impacto |
|---|---|---|---|---|
| 1 | **Comment-to-DM auto-trigger** (keyword en comentario IG/FB → reply público + DM privado con link/lead magnet) | **Brecha #1.** ManyChat/Lucid Bot/Wati; motor de growth firma de la categoría. *El path de private-reply por `commentId` ya existe en el código* | M | **Muy alto** — razón #1 por la que un creator elige ManyChat |
| 2 | **Cerrar Meta Tech Provider + App Review** (Advanced Access para mensajería) | Bloqueador de lanzamiento; sin esto no operamos a escala (hoy testers/ventana 24h) | L (proceso/espera) | **Existencial** |
| 3 | **Scope-lock server-enforced** (anexar siempre refusal "único dominio" + character-lock, sin importar persona) | Mantiene el lado-permitido del ban como invariante, no default frágil | S | **Alto** (de-risk regulatorio) |
| 4 | **Billing/Stripe self-serve** con tiers públicos anclados en ROI | Todos los rivales cobran; nosotros no. Sin esto no hay revenue | M | **Muy alto** |
| 5 | **Pipeline Kanban de ventas** (etapas, drag-drop, deal value) | Kommo/Leadsales/Clientify/Cliengo; checklist de cualquier "CRM" | M | **Alto** — desbloquea el comprador que busca "CRM" |
| 6 | **Atribución CTWA** (capturar `ctwa_clid`, atribuir conversación→ad→pedido en `/metricas`) | Brecha vs Meta/Interakt/360dialog; el comerciante LatAm gasta en CTWA y no sabe el ROI | M | **Muy alto** — diferenciador que ningún Tier A ejecuta bien |

**Secuencia:** 1+3+4+6 en paralelo (growth + compliance + revenue + atribución), 2 de fondo (proceso Meta), 5 inmediatamente después.

### P1 — SIGUIENTE (ganar a cada tier + completar la plataforma)

| # | Feature | Brecha | Effort | Impacto |
|---|---|---|---|---|
| 7 | Story-reply automation + "Say Hi to New Followers" | Completa el set IG-growth de ManyChat/Lucid Bot | M | Alto |
| 8 | **White-label / "Marca Blanca"** para agencias | Lucid Bot; abre canal reseller (las agencias que Meta "exprimió") | M | **Alto** (distribución multiplicadora) |
| 9 | **Integraciones COD LatAm: Dropi** (prioridad), Effi, Mastershop, Rocketfy | Chatea PRO/Lucid Bot; Dropi domina el dropshipping COD | L | **Alto** (desbloquea el dropshipper) |
| 10 | **Atribución de ventas manuales/cash** (no solo Shopify) | Hueco fatal: somos plataforma contra-entrega con atribución solo-tarjeta-Shopify | M | **Alto** (credibilidad + foso) |
| 11 | Botón explícito de takeover humano (1 click, no por keyword/count) | UX de equipo vs todos | S | Medio-alto |
| 12 | Cablear `first_inbound` flow trigger | Brecha interna conocida | S | Medio |
| 13 | Voz/TTS (ElevenLabs) — notas de voz del bot | Lucid Bot; el voice note es nativo cultural en LatAm | M | Medio-alto |
| 14 | Widget web-chat embebible | Landbot/Cliengo/Tidio; canal inbound que no cubrimos | M | Medio |
| 15 | SMS + email sequences en broadcasting (no solo WhatsApp) | ManyChat/Zenvia/Gupshup | M | Medio |

### P2 — DESPUÉS (escala, paridad con Pancake, defensa enterprise)

| # | Feature | Brecha | Effort | Impacto |
|---|---|---|---|---|
| 16 | App móvil nativa iOS/Android | Pancake/ManyChat/casi todos; equipos LatAm gestionan desde el teléfono | L | Medio-alto (a escala) |
| 17 | Más canales: TikTok, Telegram, Mercado Libre | ManyChat/Pancake/Botmaker | M | Medio |
| 18 | Livestream commerce (pedidos de comentarios de Live) | Pancake | L | Medio (apuesta) |
| 19 | BYOK multi-LLM opcional (power users) | Lucid Bot/Pancake; hedge de costo | M | Bajo-medio |
| 20 | Marketplace de plantillas + hub de educación/comunidad | ManyChat/Pancake; moat de ecosistema | L | Medio (largo plazo) |

---

## 4. Qué ya tenemos mejor (amplificar en marketing, no tocar)

Seis diferenciadores reales, verificados en código. Cada uno con su ángulo de mensaje:

1. **Pedido contra-entrega / pago pendiente** ([`create-order.ts`](../src/lib/shopify/create-order.ts)) — *el héroe del messaging.*
   > *"Meta 'cierra ventas' con checkout-tarjeta. Wati/Zoko son tarjeta-primero. Riverz crea el pedido contra-entrega REAL — el modelo que de verdad mueve ventas en Colombia, México y Argentina."*

2. **Conocimiento product-first con Claude + guardrails** ([`training-material.ts`](../src/lib/products/training-material.ts): `never_say`/`escalation_triggers`/`health_sensitive`).
   > *"ManyChat lee una sola URL. Lucid Bot te hace traer tu propia API key. Riverz compila tu catálogo Shopify + scrape + FAQs en conocimiento entrenado con barreras por producto — incluido, sin sorpresas de facturación de tokens."*

3. **Incrementalidad con grupo holdout** ([`attribution.ts`](../src/lib/instagram-agent/attribution.ts)).
   > *"Todos te muestran 'recuperamos 30%'. Solo Riverz prueba el lift causal real con grupo de control."* Nadie del set tiene equivalente.

4. **Bandeja unificada de 7 canales incl. email** ([`channels/types.ts`](../src/lib/channels/types.ts)).
   > *"El agente de Meta es per-canal y no toca tu correo. ManyChat es marketing-channels. Riverz unifica WhatsApp + IG + Messenger + comentarios + Gmail + Outlook en un hilo, un cliente."*

5. **Bilingüe es/en LatAm-first nativo.** *(Nota: úsalo como diferenciador vs competidores, no vs Meta — Meta localiza la conversación del cliente nativamente. El verdadero diferenciador es el **workflow comercial localizado**: contra-entrega, transferencia, novedades, guías.)*
   > *"ManyChat tiene localización débil, Pancake es vietnamita-first, Chatea solo-español. Riverz es bilingüe es/en desde el día uno."*

6. **Atribución de ingresos cross-herramienta** (`/metricas`).
   > *"Meta te da ROI de su ad dentro de su jardín. Riverz te dice qué broadcast, qué flujo, qué automatización generó qué pesos en Shopify."*

---

## 5. Posicionamiento recomendado

### Statement

> **Riverz es el sistema operativo de comercio conversacional para tiendas Shopify de LatAm: la IA de Claude que crea pedidos contra-entrega reales, dentro de una bandeja de equipo multicanal, con campañas y atribución de ingresos que Meta no le dará a un negocio pyme.**

Dejamos de vender *"un chatbot de WhatsApp"* (commodity gratis de Meta) y vendemos **outcomes de comercio + la plataforma donde la IA vive.**

### Proof points

1. **Pedidos contra-entrega reales, no links de checkout** — la IA arma y crea el pedido en Shopify con pago pendiente. *(Meta, Wati, Zoko: tarjeta-primero.)*
2. **Una bandeja, siete canales, un cliente** — con asignación de equipo y dedup cross-canal. *(Meta es per-canal; ManyChat no hace email.)*
3. **Conocimiento de marca, no FAQ pegado** — catálogo + scrape + research con barreras por producto, IA managed incluida. *(Lucid Bot: BYOK; ManyChat: una URL.)*
4. **Atribución honesta de pesos** — incrementalidad con holdout + atribución de ingresos Shopify por campaña + (próximo) CTWA. *(Nadie del Tier A mide lift causal.)*
5. **Compliant by design en la era post-ban de Meta** — agente task-specific server-enforced sobre Cloud API oficial, del lado permitido del ban que extermina a los wrappers genéricos y bots QR/SIM.
6. **Tu data no alimenta los ads de Meta** *(grieta #2 del video)* — el agente nativo de Meta usa las conversaciones para su máquina publicitaria (política 18-dic-2025); con Riverz el merchant es dueño de su data (Anthropic como subprocesador, sin uso publicitario). Ángulo fuerte para negocios con información sensible.

### Narrativa de una línea para ventas

> *"Meta probó que todo negocio necesita un agente de IA — y de paso eliminó a la mitad de nuestros competidores. Riverz es la versión que crea el pedido, unifica todos tus canales, corre tus campañas y te dice qué generó cada peso. Lo que Meta no construirá para una tienda pyme de LatAm."*

---

## 6. La verdad brutal sobre nuestras brechas

No las endulcemos. Hoy nos falta, y nos cuesta ventas:

1. **Comment-to-DM auto-trigger** — la feature firma de la categoría, no la tenemos.
2. **Pipeline Kanban** — cualquier comprador que diga "CRM" lo espera.
3. **Billing/Stripe** — no podemos cobrar.
4. **Tech Provider/App Review sin cerrar** — no operamos a escala.
5. **Atribución solo-Shopify** — perdemos las ventas cash/manuales que abundan en un mercado contra-entrega (irónico).
6. **Sin integraciones Dropi/COD-fulfillment** — perdemos al dropshipper.
7. **Sin app móvil.**

Las primeras cuatro son **P0** porque cada una es, por sí sola, una razón de "no" en un demo. El foso (sección 4) es real, pero **un foso no cierra ventas si el puente (sección 3) no está construido.**

---

## Anexo A — Análisis del video con Gemini 3.1 Pro

El video se analizó con **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) ingiriendo el YouTube directamente (audio + pantalla; 92.6k tokens de video procesados, no un transcript de texto). Resumen de los hallazgos (detalle completo en §1.0):

- **Creador:** Kevin Beller (comunidad "Vibe Community VIP" en Skool).
- **Tesis real:** título alarmista, mensaje optimista — *"el bot simple muere, pero el negocio apenas empieza"*. Recomienda pivotar a **consultoría de IA + automatización de procesos internos + integraciones a medida (CRMs/ERPs/voz) + aprender MCP/microservicios/Vibe Coding/SDD**, convirtiéndose en el **"director de orquesta"** que conecta todo (justo lo que se discute en el t=728s que marcó el usuario).
- **Las 3 grietas de Meta** que enumera (caja cerrada sin MCP / privacidad-ads / data debe vivir en Meta) son aperturas directas para Riverz (mapeadas en §1.0).
- **Productos/datos citados:** Meta Business Agent Platform; integraciones Shopify/Zendesk/Shopee; Usernames+buscador en WhatsApp; cobro en el chat; política de datos-para-ads del 18-dic-2025; el 99% de negocios aún sin automatizar; curva de adopción; ejemplos renta de autos (demo de Meta) y ferretería con miles de SKUs.
- **Herramientas mencionadas:** n8n, Obsidian ("segundo cerebro"), Twilio (voz), Skool, Zoom, Claude (el modelo transcribe "OpenClou"), MCP.

> **Por qué importa:** el video NO declara obsoleto a un producto como Riverz; declara obsoleto al *bot simple de Q&A*. Su prescripción ("vuélvete el orquestador/integrador que Meta no puede ser") **valida la tesis de Riverz** y nos da un guión de ventas listo (las 3 grietas + el ángulo de privacidad).

La salida cruda de Gemini quedó en `C:\tmp\gemini_video_analysis.md` (local, no commiteado).

## Anexo B — Fuentes clave

- Meta Business Agent: [about.fb.com/news (jun-2026)](https://about.fb.com/news/2026/06/meta-business-agent/) · [TechCrunch 2026-06-03](https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/) · [WABetaInfo](https://wabetainfo.com/meta-introduces-ai-business-agent-for-whatsapp-worldwide/)
- Ban del 15-ene-2026 (propósito general): [Semana](https://www.semana.com/tecnologia/articulo/adios-a-los-chatbots-en-whatsapp-meta-anuncia-radical-cambio-en-la-aplicacion-de-mensajeria-para-2026/202504/) · [Agentify](https://www.agentify.uy/blog/post/meta-cambia-las-reglas-para-whatsapp-adios-a-los-chatbots-de-ia-de-proposito-general-a-partir-del-15-de-enero-de-2026/) · [Infobae (salida de ChatGPT/Copilot)](https://www.infobae.com/tecno/2025/12/06/chatgpt-copilot-y-otras-ia-se-retiran-de-whatsapp-la-razon-detras-de-su-salida-de-la-plataforma/)
- Orden antitrust UE (reabrir a rivales): [Infobae 2026-06-10](https://www.infobae.com/tecno/2026/06/10/meta-enfrenta-una-nueva-presion-de-europa-debera-hacer-compatible-whatsapp-con-chatbots-de-ia-de-terceros/)
- Competidores: sitios oficiales + pricing pages + G2/Capterra/Shopify App Store + reviews (2025-2026). Datos crudos en el research del workflow `wf_ebe23e2d-a3f`.

---

*Documento generado por investigación multi-agente. Las afirmaciones sobre capacidades de Riverz están verificadas contra el código en `src/`. Las cifras de competidores provienen de fuentes públicas a jun-2026 y pueden cambiar.*
