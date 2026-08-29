-- 219 — Un segundo y un tercer número para los avisos
--
-- Los avisos que manda Riverz —«se quedó sin saldo», «un caso necesita una
-- persona», «no pudimos cobrar»— salían a un solo teléfono: el del perfil del
-- dueño. En un comercio con turnos eso significa que a las once de la noche el
-- aviso llega a alguien que está durmiendo, y el que está trabajando no se
-- entera.
--
-- `alert_phone` ya existía y nunca tuvo pantalla donde escribirlo. Se suma una
-- lista para el segundo y el tercero: tres alcanzan —el dueño, el encargado y
-- un suplente— y más que eso deja de ser un aviso para ser una difusión.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS alert_phones TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN workspaces.alert_phones IS
  'Números extra a los que van los avisos de Riverz, además de alert_phone y del teléfono del perfil. Máximo dos: la pantalla no deja cargar más.';
