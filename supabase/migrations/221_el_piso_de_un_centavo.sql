-- 221 — El piso de un centavo cobraba catorce veces lo que valía la cosa
--
-- Un movimiento del libro es un entero de centavos, y `cobrar` nunca escribía
-- menos de uno. Mientras todo lo que se cobraba costaba centavos enteros eso
-- era redondeo. Con los conceptos nuevos deja de serlo: entender qué te pidió
-- el cliente sale 0,07 centavos, así que cobrar un centavo por cada uno es
-- cobrar catorce veces el trabajo — y a la cuenta que paga A COSTO se le
-- prometió exactamente lo contrario.
--
-- Redondear tampoco alcanza: un seguimiento de 1,4 centavos redondeado a 1
-- cobra de menos siempre, en la misma dirección, para siempre. El sesgo no
-- desaparece por ser chico; se acumula.
--
-- La solución es no tirar el resto. Cada consumo suma su costo exacto —en
-- milésimas de centavo— a un contador por cuenta y concepto, y recién cuando
-- ese contador pasa el centavo se escribe UN movimiento por los centavos
-- enteros que junta. El resto queda esperando al próximo. Nada se pierde y
-- nada se infla: lo que se descuenta es lo que se gastó.
CREATE TABLE IF NOT EXISTS wallet_pendientes (
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  concepto      TEXT NOT NULL,
  -- Lo que se debe y todavía no llega a un centavo.
  milicentavos  BIGINT NOT NULL DEFAULT 0,
  -- Cuántas unidades y cuánto costaron, para que el movimiento que salga diga
  -- la verdad: cubre varios eventos, no uno.
  cantidad      NUMERIC(14, 4) NOT NULL DEFAULT 0,
  costo_centavos NUMERIC(14, 6) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, concepto)
);

ALTER TABLE wallet_pendientes ENABLE ROW LEVEL SECURITY;

-- Suma un consumo al contador y devuelve lo que hay que cobrar AHORA.
--
-- Bloquea la fila igual que `wallet_mover`: dos respuestas que terminan en el
-- mismo milisegundo no pueden leer el mismo resto y cobrarlo dos veces.
CREATE OR REPLACE FUNCTION wallet_acumular(
  p_workspace      UUID,
  p_concepto       TEXT,
  p_milicentavos   BIGINT,
  p_cantidad       NUMERIC,
  p_costo_centavos NUMERIC
) RETURNS TABLE (centavos BIGINT, cantidad NUMERIC, costo_centavos NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mili  BIGINT;
  v_cant  NUMERIC;
  v_costo NUMERIC;
  v_enteros BIGINT;
BEGIN
  INSERT INTO wallet_pendientes (workspace_id, concepto)
  VALUES (p_workspace, p_concepto)
  ON CONFLICT (workspace_id, concepto) DO NOTHING;

  SELECT p.milicentavos, p.cantidad, p.costo_centavos
    INTO v_mili, v_cant, v_costo
  FROM wallet_pendientes p
  WHERE p.workspace_id = p_workspace AND p.concepto = p_concepto
  FOR UPDATE;

  v_mili  := v_mili  + GREATEST(p_milicentavos, 0);
  v_cant  := v_cant  + COALESCE(p_cantidad, 0);
  v_costo := v_costo + COALESCE(p_costo_centavos, 0);

  v_enteros := v_mili / 1000;

  IF v_enteros > 0 THEN
    centavos := v_enteros;
    cantidad := v_cant;
    costo_centavos := v_costo;
    UPDATE wallet_pendientes p
       SET milicentavos = v_mili - v_enteros * 1000,
           cantidad = 0,
           costo_centavos = 0,
           actualizado_en = now()
     WHERE p.workspace_id = p_workspace AND p.concepto = p_concepto;
  ELSE
    centavos := 0;
    cantidad := 0;
    costo_centavos := 0;
    UPDATE wallet_pendientes p
       SET milicentavos = v_mili,
           cantidad = v_cant,
           costo_centavos = v_costo,
           actualizado_en = now()
     WHERE p.workspace_id = p_workspace AND p.concepto = p_concepto;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION wallet_acumular(UUID, TEXT, BIGINT, NUMERIC, NUMERIC) FROM PUBLIC;
