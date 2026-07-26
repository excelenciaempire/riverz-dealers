-- ============================================================
-- 119 — Instagram: el gancho para ABRIR la conversación.
--
-- `persona_hint` / `external_hint` son pistas ABSTRACTAS de interés ("viajes,
-- estética outdoor") pensadas solo para calibrar el tono, y el redactor tenía
-- prohibido mencionarlas. Eso da DMs correctos pero fríos: abren vendiendo.
--
-- El objetivo del producto es el contrario: iniciar una conversación humana
-- desde algo REAL y reciente de la persona — "vi que volviste de la playa" —
-- y que la venta salga de ahí. Para eso hace falta un dato concreto y
-- mencionable, no una categoría.
--
--   opener_hint — UNA cosa pública, reciente y concreta de su perfil con la
--                 que se puede abrir de forma natural. Solo de cuentas
--                 públicas, nunca datos sensibles, y NULL cuando no hay nada
--                 que valga la pena mencionar (que es lo normal).
-- ============================================================

ALTER TABLE contact_ig_profile
  ADD COLUMN IF NOT EXISTS opener_hint TEXT;
