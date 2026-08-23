-- 187 — Los comercios que ya estaban, sin cargo
--
-- La migración anterior dejó la facturación construida, y con ella una regla:
-- una cuenta sin suscripción arranca una prueba de 5 días la primera vez que
-- alguien mira. Para un comercio nuevo es lo correcto. Para los que YA estaban
-- operando sería ponerles un reloj de 5 días encima sin avisarles.
--
-- En esta etapa a los primeros comercios se les instala gratis, así que eso es
-- literalmente lo que dice la fila: `cortesia`, que no vence y no paga. Siguen
-- contando como clientes en el panel de negocio —con su costo real y MRR 0—
-- porque sacarlos del cuadro haría parecer que no hay nadie usando la
-- plataforma justo cuando lo que hay que mirar es cuánto cuesta atenderlos.
--
-- Sólo alcanza a las cuentas que existen HOY. Una que se cree mañana entra por
-- el camino normal, con su prueba.
--
-- Idempotente: no pisa a nadie que ya tenga suscripción.

INSERT INTO workspace_subscriptions (workspace_id, plan_id, estado, nota)
SELECT
  w.id,
  (SELECT id FROM billing_plans WHERE slug = 'pro'),
  'cortesia',
  'Piloto: se le instaló sin cargo.'
FROM workspaces w
WHERE w.deleted_at IS NULL
ON CONFLICT (workspace_id) DO NOTHING;
