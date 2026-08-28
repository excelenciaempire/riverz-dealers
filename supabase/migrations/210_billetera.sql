-- 209 — Billetera: saldo por cuenta, movimientos y tarifas
--
-- Hasta hoy, para que un comercio usara la IA tenía que traer su propia clave
-- de Anthropic, y la voz ni siquiera eso: dependía de que el dueño de Riverz
-- recargara Anthropic, Telnyx y Fish Audio a mano. El comercio no tiene por qué
-- enterarse de que existen esos tres proveedores.
--
-- La billetera invierte eso: **todo corre con las llaves de Riverz** y el
-- comercio carga saldo. Cada respuesta de la IA, cada minuto de llamada y cada
-- audio sintetizado descuenta de ese saldo y deja una línea. El comercio ve
-- cuánto le queda y en qué se le fue.
--
-- Tres decisiones que explican la forma:
--
-- 1. **El libro es la fuente, no el saldo.** `wallet_accounts.saldo_centavos`
--    es una caché del acumulado de `wallet_movimientos`. Cada movimiento guarda
--    `saldo_despues_centavos`, así que el saldo se puede reconstruir y auditar.
--    Un saldo que sólo existe como número suelto no se puede discutir con un
--    cliente que reclama.
--
-- 2. **Se guarda lo que se cobra Y lo que costó.** `centavos` es lo que se le
--    descuenta al comercio; `costo_centavos` es lo que le costó a Riverz. Sin
--    las dos columnas no hay margen que mirar, y el margen es el negocio.
--
-- 3. **Las tarifas son filas, no constantes.** Igual que los planes (186): en
--    esta etapa el precio del minuto o de la respuesta se descubre probando, y
--    tenerlo compilado significa un despliegue por cada prueba.
--
-- Sin RLS en escritura: lo escribe la llave de servicio (el runner, el webhook
-- de Stripe, /admin). El comercio lee lo suyo por RPC y por la API del panel.
-- Idempotente.

-- ── El saldo de cada cuenta ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_accounts (
  workspace_id  UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  -- En centavos y entero, nunca en float: medio centavo mal redondeado por
  -- respuesta, mil respuestas después, es plata de verdad.
  saldo_centavos BIGINT NOT NULL DEFAULT 0,
  moneda        TEXT NOT NULL DEFAULT 'usd',
  -- Recarga automática. Nula = apagada; es opt-in a propósito, porque cobrarle
  -- a alguien sin que lo pida es la forma más rápida de perderlo.
  auto_recarga_centavos INT,
  auto_umbral_centavos  INT,
  -- Cuánto puede quedar en rojo antes de que se corte. Existe para que una
  -- llamada en curso no se muera a la mitad por tres centavos.
  descubierto_centavos INT NOT NULL DEFAULT 200,
  -- Cuándo se le avisó por última vez que se está quedando sin saldo, para no
  -- mandar el mismo aviso cada cinco minutos.
  avisado_en    TIMESTAMPTZ,
  -- Si quedarse sin saldo APAGA la operación. Nace en FALSE a propósito: el día
  -- que esto se despliega hay comercios andando con saldo cero, y estrenar la
  -- billetera dejándolos mudos con sus clientes sería cobrarle el estreno a
  -- ellos. Se prende cuenta por cuenta desde /admin cuando ya cargaron.
  bloquear_sin_saldo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Para las cuentas que ya existían cuando esto se aplicó.
ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS bloquear_sin_saldo BOOLEAN NOT NULL DEFAULT FALSE;

-- ── El libro: toda la plata que entra y sale ───────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_movimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- recarga  : entró plata (Stripe)
  -- consumo  : se usó algo
  -- bono     : saldo regalado (piloto, disculpa, prueba)
  -- ajuste   : corrección a mano desde /admin
  -- reembolso: se devolvió un consumo
  tipo          TEXT NOT NULL
                CHECK (tipo IN ('recarga', 'consumo', 'bono', 'ajuste', 'reembolso')),
  -- En qué se fue. Es la columna que contesta la pregunta del panel.
  concepto      TEXT NOT NULL,
  -- Firmado: positivo suma, negativo resta. Un libro con la resta implícita se
  -- lee mal la primera vez que alguien lo audita.
  centavos      BIGINT NOT NULL,
  saldo_despues_centavos BIGINT NOT NULL,
  -- Lo que le costó a Riverz. Sólo en consumos.
  costo_centavos NUMERIC(14, 6) NOT NULL DEFAULT 0,
  -- Cuánto de la unidad se consumió: 1 respuesta, 2,4 minutos, 1800 caracteres.
  cantidad      NUMERIC(14, 4),
  unidad        TEXT,
  -- De dónde salió: la conversación, la llamada, el mensaje. Sirve para que la
  -- fila del panel sea un enlace a la cosa y no un número huérfano.
  referencia_tipo TEXT,
  referencia_id   TEXT,
  -- Idempotencia de las recargas: el mismo pago de Stripe no acredita dos
  -- veces por más que el webhook llegue repetido (y llega repetido).
  stripe_id     TEXT,
  detalle       JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_por    UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_movimientos_stripe_uq
  ON wallet_movimientos (stripe_id) WHERE stripe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallet_movimientos_cuenta_idx
  ON wallet_movimientos (workspace_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS wallet_movimientos_concepto_idx
  ON wallet_movimientos (workspace_id, concepto, creado_en DESC);

-- ── Cuánto sale cada cosa ──────────────────────────────────────────────────
-- El precio al comercio por unidad. Editable desde /admin; los valores
-- sembrados son ~2x el costo de lista de cada proveedor a agosto de 2026.
CREATE TABLE IF NOT EXISTS wallet_tarifas (
  concepto      TEXT PRIMARY KEY,
  nombre_es     TEXT NOT NULL,
  nombre_en     TEXT NOT NULL,
  unidad        TEXT NOT NULL,
  -- En milésimas de centavo: una respuesta de IA sale fracciones de centavo y
  -- redondear a centavo entero cada evento cobraría de más el 90% del tiempo.
  precio_milicentavos BIGINT NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  orden         INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO wallet_tarifas (concepto, nombre_es, nombre_en, unidad, precio_milicentavos, orden)
VALUES
  ('ia_respuesta',  'Respuestas de la IA',   'AI replies',        'respuesta',   2000, 1),
  ('ia_operador',   'Operador',              'Operator',          'respuesta',   8000, 2),
  ('llamada_voz',   'Llamadas',              'Calls',             'minuto',     20000, 3),
  ('voz_tts',       'Voz sintetizada',       'Synthesized voice', '1k caracteres', 3000, 4),
  ('voz_stt',       'Transcripción',         'Transcription',     'minuto',      1500, 5),
  ('busqueda_web',  'Búsquedas en internet', 'Web searches',      'búsqueda',    2000, 6),
  ('imagen',        'Imágenes',              'Images',            'imagen',      8000, 7),
  ('investigacion', 'Investigación',         'Research',          'informe',   150000, 8)
ON CONFLICT (concepto) DO NOTHING;

-- ── Mover plata, sin carreras ──────────────────────────────────────────────
--
-- Todo pasa por acá. Bloquea la fila de la cuenta, calcula el saldo nuevo y
-- escribe el movimiento en la misma transacción: dos respuestas de la IA que
-- terminan en el mismo milisegundo no pueden leer el mismo saldo y pisarse.
--
-- `p_stripe_id` hace la recarga idempotente: si ese pago ya se acreditó,
-- devuelve el saldo actual y no suma de nuevo.
CREATE OR REPLACE FUNCTION wallet_mover(
  p_workspace UUID,
  p_tipo TEXT,
  p_concepto TEXT,
  p_centavos BIGINT,
  p_costo NUMERIC DEFAULT 0,
  p_cantidad NUMERIC DEFAULT NULL,
  p_unidad TEXT DEFAULT NULL,
  p_referencia_tipo TEXT DEFAULT NULL,
  p_referencia_id TEXT DEFAULT NULL,
  p_stripe_id TEXT DEFAULT NULL,
  p_detalle JSONB DEFAULT '{}'::jsonb,
  p_creado_por UUID DEFAULT NULL
) RETURNS TABLE (movimiento_id UUID, saldo_centavos BIGINT, duplicado BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo BIGINT;
  v_id UUID;
BEGIN
  IF p_stripe_id IS NOT NULL THEN
    SELECT m.id, m.saldo_despues_centavos INTO v_id, v_saldo
      FROM wallet_movimientos m WHERE m.stripe_id = p_stripe_id;
    IF FOUND THEN
      RETURN QUERY SELECT v_id, v_saldo, TRUE;
      RETURN;
    END IF;
  END IF;

  INSERT INTO wallet_accounts (workspace_id)
    VALUES (p_workspace)
    ON CONFLICT (workspace_id) DO NOTHING;

  SELECT a.saldo_centavos INTO v_saldo
    FROM wallet_accounts a WHERE a.workspace_id = p_workspace FOR UPDATE;

  v_saldo := v_saldo + p_centavos;

  UPDATE wallet_accounts
     SET saldo_centavos = v_saldo, updated_at = now()
   WHERE workspace_id = p_workspace;

  INSERT INTO wallet_movimientos (
    workspace_id, tipo, concepto, centavos, saldo_despues_centavos,
    costo_centavos, cantidad, unidad, referencia_tipo, referencia_id,
    stripe_id, detalle, creado_por
  ) VALUES (
    p_workspace, p_tipo, p_concepto, p_centavos, v_saldo,
    COALESCE(p_costo, 0), p_cantidad, p_unidad, p_referencia_tipo, p_referencia_id,
    p_stripe_id, COALESCE(p_detalle, '{}'::jsonb), p_creado_por
  ) RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_saldo, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION wallet_mover(UUID, TEXT, TEXT, BIGINT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;

-- ── Lo que ve el comercio ──────────────────────────────────────────────────
ALTER TABLE wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_accounts_select ON wallet_accounts;
CREATE POLICY wallet_accounts_select ON wallet_accounts
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS wallet_movimientos_select ON wallet_movimientos;
CREATE POLICY wallet_movimientos_select ON wallet_movimientos
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

-- Las tarifas las puede leer cualquiera que esté adentro: son el precio, y un
-- precio escondido es una pelea con el cliente esperando a pasar.
ALTER TABLE wallet_tarifas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_tarifas_select ON wallet_tarifas;
CREATE POLICY wallet_tarifas_select ON wallet_tarifas
  FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE wallet_accounts IS
  'Saldo prepago por cuenta. El número es una caché: la verdad está en wallet_movimientos.';
COMMENT ON TABLE wallet_movimientos IS
  'Libro de la billetera. Append-only: nada se edita ni se borra, las correcciones son movimientos de tipo ajuste.';
COMMENT ON COLUMN wallet_movimientos.costo_centavos IS
  'Lo que le costó a Riverz. La otra mitad del margen; no se puede recalcular después porque las tarifas de los proveedores cambian.';
