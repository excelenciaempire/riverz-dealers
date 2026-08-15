-- ============================================================
-- 151 — Teléfono de la persona del comercio
-- ============================================================
--
-- Las aprobaciones ("un cliente dice que pagó, ¿lo marco como pagado?") salen
-- por el WhatsApp de Riverz al dueño del comercio. `askForApproval` buscaba ese
-- teléfono en `profiles.phone` — una columna que nunca existió, así que la
-- consulta fallaba, no había a quién preguntarle y cada decisión quedaba
-- escrita en la tabla sin que nadie se enterara nunca.
--
-- Va en `profiles` y no en `workspaces` porque quien decide es una persona, no
-- una cuenta: el dueño primero y, si no tiene, el primer administrador con
-- teléfono cargado.
--
-- NULL = todavía no lo cargó. En ese caso la aprobación se sigue escribiendo y
-- se ve en el panel; lo único que se pierde es el aviso que va a buscarlo.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;
