-- 188 — El consumo que ya había, acumulado hacia atrás
--
-- El cron acumula desde que existe. Sin esto, el panel de negocio arrancaría en
-- cero y el costo de atender a los comercios —que es la mitad del cuadro que
-- hay que mirar— tardaría un mes en poder leerse.
--
-- Es la misma cuenta que hace `acumularDia` en el código, escrita una vez sobre
-- los 90 días de historia que hay. La tarifa por modelo no se replica acá: se
-- usa la del modelo por defecto, y el cron va corrigiendo día a día lo que
-- vuelve a tocar. Sirve para tener el orden de magnitud desde el minuto uno, no
-- para facturarlo.
--
-- Idempotente: la clave es (cuenta, día) y se pisa.

INSERT INTO billing_usage_daily
  (workspace_id, dia, conversaciones, respuestas, prompt_tokens, completion_tokens, costo_usd)
SELECT
  r.workspace_id,
  r.created_at::date AS dia,
  COUNT(DISTINCT r.conversation_id) AS conversaciones,
  COUNT(*) AS respuestas,
  COALESCE(SUM(r.prompt_tokens), 0) AS prompt_tokens,
  COALESCE(SUM(r.completion_tokens), 0) AS completion_tokens,
  -- Tarifa de Haiku 4.5, que es el modelo por defecto de los agentes:
  -- US$1 por millón de entrada y US$5 por millón de salida.
  ROUND(
    (COALESCE(SUM(r.prompt_tokens), 0)::numeric / 1000000) * 1
    + (COALESCE(SUM(r.completion_tokens), 0)::numeric / 1000000) * 5,
    6
  ) AS costo_usd
FROM ai_replies r
WHERE r.status = 'sent'
  AND r.created_at > now() - interval '90 days'
  AND r.workspace_id IS NOT NULL
GROUP BY r.workspace_id, r.created_at::date
ON CONFLICT (workspace_id, dia) DO UPDATE SET
  conversaciones = EXCLUDED.conversaciones,
  respuestas = EXCLUDED.respuestas,
  prompt_tokens = EXCLUDED.prompt_tokens,
  completion_tokens = EXCLUDED.completion_tokens,
  costo_usd = EXCLUDED.costo_usd,
  actualizado_en = now();
