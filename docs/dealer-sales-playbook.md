# Dealer sales execution / Ejecución comercial

Reviewed 2026-10-02. This is an implementation map, not a guarantee of sales results.

## Source decisions / Decisiones sobre las fuentes

| Source supplied by the owner | Useful practice | Product implementation |
| --- | --- | --- |
| Cómo Hablar Con Leads & Aumentar Show-Up Rate, 5 pages | Fast response, personalized video, appointment preparation, missed-visit rescue | Five-minute seller goal, prioritized action queue, video activity evidence, preparation checklist, bounded no-show event |
| Dealers Growth Guión Para Agendar Citas V2, 5 pages | Understand motivation and vehicle needs, offer actual alternatives, explain visit value | Buying motivation, preferences, live inventory tools, requested appointment requiring seller confirmation |
| Dealers Growth Tips Para Las Llamadas, 2 pages | Help first, converse naturally, avoid repeated questions, communicate real benefits | Assistant answers first and asks one relevant question; seller discovery and objection coaching |
| Dealers Growth Guión Para Agendar Citas, 3 pages | Discover timing and resolve concerns before scheduling | Buying timeframe, pending objection, next action and appointment calendar |
| GUIA PARA BDC, 3 pages | Distinguish first-time/replacement buyers and hand off financing | Buyer type, optional trade-in context, finance-handoff activity; no automated underwriting |

The BDC guide's page 2 gives price / 72 as a payment shortcut and promises terms based on credit score. Those statements are **not** product rules: interest, fees, lender conditions and underwriting are not established by a general script. The assistant does not promise credit approval, zero down, APR, appraisal or an invented promotion. Card limits, debt schedules and SSNs are not added to qualification forms. Triple calls, endless follow-up and disguising bulk messages as human messages are also not defaults.

## Primary public sources / Fuentes públicas primarias

- [Andy Elliott automotive and BDC training](https://elliott247.com/automotive): identifies objection, phone and dealership training as focus areas. Marketing claims are not treated as independently proven outcomes.
- [Andy Elliott interview, Driving Vision EP128](https://www.drivingvisionpodcast.com/andy-elliot-classic-episode-replay-ep128/), published 2024-07-09: Elliott describes consistent training and practicing customer objections. Adaptation: short discovery/objection coaching next to actual buyer context, rather than copying pressure tactics.
- [Alex Hormozi's public lead-response example](https://www.linkedin.com/posts/alexhormozi_i-spoke-to-a-business-owner-who-gets-to-100-activity-7365057768468201472-dbkd): an anecdote about contacting leads within 60 seconds. Adaptation: prioritize new buyers and measure response evidence. The anecdote's conversion numbers are not dealership benchmarks or promised improvements.
- [Acquisition.com official Leads course](https://www.acquisition.com/training/leads): the public syllabus includes outreach, referrals and improving existing acquisition. The visible page provides a syllabus, not a verified transcript of every lesson; no specific cadence is attributed to unseen video content.

## Shipped behavior / Comportamiento implementado

1. New contacts create an inquiry opportunity in the independent dealer database. Saving qualification reuses the open opportunity atomically instead of creating duplicates.
2. Today and BDC rank new buyers, requested appointments, visit preparation, missed visits, post-visit follow-up and due next actions. Paused, closed and opted-out buyers are excluded.
3. Activity recording stores the authenticated seller, server timestamp and actual outcome. An unanswered call is not a connected call. Recording activity never places a call or sends a message itself.
4. Each activity records a next date and purpose, or pauses automatic follow-up. Connected-call timestamps and manual outbound contact evidence remain distinct.
5. Appointments track buyer attendance confirmation, prepared vehicle and directions sent. Changing the time or location resets that checklist. A future visit cannot be marked completed/no show.
6. The funnel uses one 30-day buyer cohort. Connected calls, buyers with appointments, completed visits and recorded sales have explicit denominators. Show-up counts only completed/no-show appointment outcomes.
7. Four dealer recipes reuse Riverz's durable automation engine: agreed follow-up, confirmed appointment reminder, missed-visit rescue and post-visit follow-up. Each requires an approved message template before activation. Outcome events expire after one day and revalidate live state before each step; seller contact, buyer reply, rescheduling, opt-out, pause, closure or unavailable inventory invalidates the applicable sequence.
8. The assistant stores motivation, preferences, timeframe, buyer type and concerns, checks actual available vehicles, and requests appointments. Inventory quotes are rechecked before delivery; the test panel uses real inventory but simulated writes.
9. The seller's Operator reads the same BDC priorities and cohort metrics through `dealers.estado`. Its shared planning instructions use dealer recipes and prohibit treating ecommerce orders as car sales. New customer assistants receive four dealer-specific inventory, discovery, appointment and financing rules.

The five-minute goal and bounded cadence are product choices inspired by the sources, not empirically proven optimal values for this dealer. The seller can record another agreed follow-up date. Calendar/DMS integrations, connected outbound calling, lender decisions and trade-in valuation are separate integrations, not implied by the activity log. External channels require their provider configuration; template approval is not fabricated.

## Implementation evidence / Evidencia

- Schema and tenant invariants: migrations 375–377 and `src/lib/dealers/schema.test.ts`.
- Action ranking and cohort math: `src/lib/dealers/sales-execution.ts` and its behavioral tests.
- Authenticated seller actions: `/api/dealers`, `dealer_log_activity`, append-only activity permissions.
- Assistant rules/tools: `src/lib/dealers/agent-tools.ts`; quote evidence in `quote-evidence.ts`.
- Bilingual interfaces: `dealer-workspace.tsx`, `sales-execution.tsx`, ES/EN dealer and automation catalogs.

## Uso en español

Abre **Hoy** para atender prioridades y **BDC · Seguimiento** para registrar resultados y ver el embudo. Registra sólo llamadas, videos o mensajes que realmente realizaste. Antes de una visita, marca asistencia confirmada, indicaciones enviadas y vehículo preparado. Selecciona la plantilla aprobada correspondiente en Automatizaciones; la galería no activa mensajes por sí sola.

## English use

Open **Today** for priorities and **BDC · Follow-up** to record outcomes and view the funnel. Log only calls, videos or messages actually completed. Before a visit, record buyer confirmation, directions sent and vehicle preparation. Choose the corresponding approved template in Automations; opening a recipe does not activate messaging.
